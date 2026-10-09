import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { createHash, randomUUID } from "node:crypto";
// The Pi batch adapter imports the host-neutral runtime modules statically,
// exactly as the Claude adapter does; the adapter-owned helpers it drives
// (the shared session progression accessors and the batch projection) live in
// ./imm-canary-work.ts next to the assurance machinery they use.
import { readSettledTaskEvidence } from "../runtime/kernel/storage";
import {
	createBatchAuthorityRegistry,
	type BatchAuthorityRegistry,
} from "../runtime/kernel/batch_authority";
import { createEnrollmentAuthorityRegistry } from "../runtime/kernel/enrollment_authority";
import {
	startBatch,
	type BatchRunnerKernelPort,
	type BatchRunReport,
} from "../runtime/unattended/batch_runner";
import { createBatchKernelPort } from "../runtime/unattended/batch_kernel_port";
import type { BatchRunnerGitPort } from "../runtime/unattended/batch_git";
import type { InitiativeObservationReader } from "../runtime/unattended/types";
import { advancePiTask } from "./imm-canary-work";
import { batchReason } from "../runtime/unattended/batch_reasons";
import { parseLaneOffers, parseMaxParallel, type LaneOffer } from "../runtime/unattended/batch_lanes";
import {
	authorizeBatch,
	projectBatchPreflight,
} from "../runtime/unattended/batch_preflight";
import {
	presentTaskRail,
	renderStructuredCall,
	renderStructuredResult,
	requestAuthorityDialog,
} from "./pi-canary-interaction";
import { throwToolFailure } from "./pi-canary-tool-failure";

/**
 * Read the Authority Store's settled Run evidence for a child and project its
 * scope and intent sidecar from that Run only.
 *
 * A child reaches Kernel settlement before the batch commits it, and settlement
 * clears the live state record, so the batch resume preflight must resolve the
 * child's authorized scope from the settled run instead. Read-only: neither the
 * store read nor this reader mutates Kernel state. Currently caller-free: the
 * shared `batch_preflight.ts` performs its own settled read, and this reader
 * answers with the current Run's evidence — an earlier Run's exported pair or
 * a stale flat pair is never returned for a re-enrolled Task.
 */
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


/**
 * Map the native dialog selection to the gate decision. The registered tool's
 * dialog exposes confirm, decline, and cancel; Escape (undefined) is cancel so
 * the repository and authority stay untouched. Exported for the registered-tool
 * contract test: the dialog sits behind plan projection, so the mapping itself
 * is the testable unit, and the direct-execution suites cover the decision
 * outcomes (decline -> rejected, cancel/Escape -> cancelled) with zero writes.
 */
export function mapDialogSelection(selected: string | undefined): "accept" | "decline" | "cancel" {
	if (selected === "confirm") return "accept";
	if (selected === "decline") return "decline";
	return "cancel";
}

/**
 * The one refusal a non-interactive Host gets. The registered tool surface and
 * the batch entry point share it, so they cannot drift on which Host may run a
 * batch or on how to recover from asking one that may not.
 */
function nonInteractiveRefusal(): { reason: string; recovery_action: string } {
	return {
		reason: "interactive TUI elicitation is unavailable in non-interactive mode",
		recovery_action: "invoke through an interactive Pi TUI session in the current Host",
	};
}

/**
 * Batch execution the Host adapters drive: everything above is shared with the
 * Claude adapter and the decisions below are the Host's own.
 */
export interface PiBatchExecutionOptions {
	root: string;
	initiativeSlug: string;
	interactive?: boolean;
	/**
	 * Gate-free continuation after a foreground child: never opens the
	 * confirmation, and an authorization that cannot be reused is reported as a
	 * blocked result with the one action that reopens the gate.
	 */
	reuseOnly?: boolean;
	signal?: AbortSignal;
	/** Lane mode: how many children may run at once. Absent selects the serial path. */
	max_parallel?: number;
	/** Lane mode: Lanes someone else created, offered to the batch. */
	lane_offers?: LaneOffer[];
	batchKernel?: Partial<BatchRunnerKernelPort>;
	batchGit?: BatchRunnerGitPort;
	readInitiative?: InitiativeObservationReader;
	confirmBatch?: (details: {
		title: string;
		summary: string;
		details: string;
		planDigest: string;
		signal?: AbortSignal;
	}) => Promise<"accept" | "decline" | "cancel">;
}

export type PiBatchExecutionResult =
	| { state: "started"; batch_id: string; report: BatchRunReport }
	| { state: "rejected"; reason: string; recovery_action: string }
	| { state: "cancelled"; reason: string; recovery_action: string }
	| { state: "blocked"; reason: string; recovery_action: string };

function piConfirmationRef(input: {
	toolCallId: string;
	requestId: string;
	operation: string;
	initiativeSlug: string;
	planDigest: string;
}): string {
	return `pi-confirm-${createHash("sha256")
		.update(`${input.toolCallId}\0${input.requestId}\0${input.operation}\0${input.initiativeSlug}\0${input.planDigest}`)
		.digest("hex")
		.slice(0, 16)}`;
}

export async function executePiUnattendedBatch(
	options: PiBatchExecutionOptions,
): Promise<PiBatchExecutionResult> {
	const { root, initiativeSlug, signal } = options;
	const reuseOnly = options.reuseOnly === true;
	const interactive = options.interactive ?? true;

	if (!reuseOnly && !interactive) return { state: "rejected", ...nonInteractiveRefusal() };

	// 1. Host-independent batch preflight: claim ownership, branch availability,
	// working-tree cleanliness against the authorized scope, recovery children,
	// plan digest, and base HEAD are one shared projection, so neither Host
	// re-implements a batch decision.
	let now = new Date().toISOString();
	const preflight = await projectBatchPreflight({
		root,
		initiative_slug: initiativeSlug,
		now,
		readInitiative: options.readInitiative,
	});
	if (!preflight.ok) {
		return { state: preflight.state, reason: preflight.reason, recovery_action: preflight.recovery_action };
	}
	const isResuming = preflight.projection.is_resuming;
	const batchBranch = preflight.projection.batch_branch;
	const existingBatch = preflight.projection.existing_batch;
	const budget = preflight.projection.budget;
	const planDigest = preflight.projection.plan_digest;
	const recoveryChildren = preflight.projection.recovery_children;

	// 4. Literal-user gate plus the shared reuse decision, the post-gate
	// claim/drift cascade, and the Batch Authorization binding. The Host supplies
	// only its gate, its confirmation reference, and its binding nonce.
	const authorization = await authorizeBatch<PiBatchExecutionResult>({
		root,
		initiative_slug: initiativeSlug,
		now,
		projection: preflight.projection,
		readInitiative: options.readInitiative,
		nonce: randomUUID(),
		gate: async (facts) => {
			if (reuseOnly)
				return {
					kind: "host_rejection",
					value: {
						state: "blocked",
						reason: `batch authorization cannot be reused (${facts.reuse_blockers.join(", ")})`,
						recovery_action: "call start_unattended_batch with the same Initiative to confirm a fresh authorization",
					},
				};
			// review-2: fail closed with zero writes when confirmation port is missing
			if (!options.confirmBatch) {
				return { kind: "host_rejection", value: batchReason("confirmation_port_unavailable") };
			}
			const confirmDetails = {
				title: `Authorize Unattended Batch: ${facts.initiative_slug}`,
				summary: `Initiative: ${facts.initiative_slug}\nBatch branch: ${facts.batch_branch}\nPlan digest: ${facts.plan_digest}\nBudget: max_children=${facts.budget.max_children}, qa_failure_limit=${facts.budget.qa_failure_limit}${options.max_parallel !== undefined ? `\nLane mode: max_parallel=${options.max_parallel}` : ""}`,
				details: `Ordered children (${facts.children.length}):\n${facts.children.map((child) => `  - ${child.task_id} (${child.slice_id}) [risk: ${child.risk}] [status: ${child.status === "already_settled" ? "completed" : "pending execution"}]`).join("\n")}${facts.excluded.length > 0 ? `\n\nExcluded children:\n${facts.excluded.map((child) => `  - ${child.task_id} (${child.slice_id}): ${child.reason}`).join("\n")}` : ""}${options.max_parallel !== undefined ? `\n\nParallel groups (${facts.parallel_groups.length}):\n${facts.parallel_groups.map((group) => `  - ${group.join(", ")}`).join("\n")}${facts.scope_conflicts.length > 0 ? `\n\nSerialized by overlapping scope:\n${facts.scope_conflicts.map((c) => `  - ${c.task_id} after ${c.overlaps_with.join(", ")}`).join("\n")}` : ""}` : ""}${facts.reuse_blockers.length > 0 ? `\n\nRe-confirmation required: ${facts.reuse_blockers.join(", ")}.\nRecovery: confirm to issue a fresh authorization bound to the current plan and HEAD.` : ""}`,
				planDigest: facts.plan_digest,
				signal,
			};

			// The gate settles only on the literal user's answer or the caller's
			// cancellation signal.
			let decision: "accept" | "decline" | "cancel";
			try {
				decision = await options.confirmBatch(confirmDetails);
			} catch (err) {
				if (signal?.aborted) return { kind: "host_rejection", value: batchReason("confirmation_cancelled") };
				return {
					kind: "host_rejection",
					value: batchReason("confirmation_failed", err instanceof Error ? err.message : String(err)),
				};
			}

			if (decision === "cancel" || signal?.aborted) {
				return { kind: "host_rejection", value: batchReason("confirmation_cancelled") };
			}
			if (decision === "decline") {
				return { kind: "host_rejection", value: batchReason("confirmation_declined") };
			}
			if (decision !== "accept") {
				return { kind: "host_rejection", value: batchReason("confirmation_no_decision") };
			}
			return { kind: "confirmed", request_id: randomUUID() };
		},
		confirmationRef: ({ batch_id, request_id }) =>
			piConfirmationRef({
				toolCallId: `call-${batch_id}`,
				requestId: request_id ?? randomUUID(),
				operation: "start_unattended_batch",
				initiativeSlug,
				planDigest,
			}),
	});
	if (authorization.outcome === "host_rejection") return authorization.value;
	if (authorization.outcome === "rejected") return authorization.rejection;
	const { binding, batch_id: batchId } = authorization;

	// 6. Issue Batch Authorization through Kernel registry and startBatch
	const batchRegistry: BatchAuthorityRegistry = await createBatchAuthorityRegistry();
	const enrollmentRegistry = await createEnrollmentAuthorityRegistry();

	// review-2: verify cancellation signal right before authority issuance and startBatch
	if (signal?.aborted) return batchReason("cancelled_before_execution");

	now = new Date().toISOString();
	const capability = batchRegistry.issue(binding, recoveryChildren as any, now);

	let activeReviewDispatch: { operation_id: string; agent_params: Record<string, unknown> } | null = null;

	const { advanceTask: overrideAdvanceTask, ...otherOverrides } = options.batchKernel ?? {};
	const baseAdvanceTask = overrideAdvanceTask ?? advancePiTask;
	const advanceTask: BatchRunnerKernelPort["advanceTask"] = async (taskRoot, taskId) => {
		const res = (await baseAdvanceTask(taskRoot, taskId)) as Awaited<ReturnType<typeof advancePiTask>>;
		if (res.state === "review_ready" && res.agent_params) {
			activeReviewDispatch = {
				operation_id: res.operation_id,
				agent_params: res.agent_params,
			};
		}
		return res;
	};
	// The production child Kernel port is the shared runtime/unattended one;
	// this Host supplies only its own advanceTask progression seam (D5).
	const kernelPort = createBatchKernelPort({
		root,
		enrollmentRegistry,
		registry: batchRegistry,
		capability,
		binding,
		advanceTask,
		resume: { isResuming, existingBatch, batchBranch },
		overrides: otherOverrides,
	});

	const report = await startBatch({
		root,
		batch_id: batchId,
		initiative_slug: initiativeSlug,
		registry: batchRegistry,
		capability,
		children: recoveryChildren,
		plan_digest: planDigest,
		base_head: binding.base_head,
		confirmation_time: now,
		budget,
		now,
		kernel: kernelPort,
		git: options.batchGit,
		...(options.max_parallel !== undefined ? { max_parallel: options.max_parallel } : {}),
		...(options.lane_offers !== undefined ? { lane_offers: options.lane_offers } : {}),
	});

	if (report.batch_state === "rejected") {
		return batchReason("batch_run_rejected", report.reason ?? "");
	}

	return {
		state: "started",
		batch_id: batchId,
		report,
		...(activeReviewDispatch ? { review_dispatch: activeReviewDispatch } : {}),
	};
}

/**
 * Injectable seams for the batch Tool. Production passes nothing and gets the
 * real Initiative reader, Kernel port and Git port; tests drive the registered
 * Tool `execute` end to end without live GitHub or Kernel access, which is how
 * the model-visible content contract is verified.
 */
export interface PiBatchExtensionDependencies {
	readInitiative?: InitiativeObservationReader;
	batchKernel?: Partial<BatchRunnerKernelPort>;
	batchGit?: BatchRunnerGitPort;
}

export default function (
	pi: ExtensionAPI,
	dependencies: PiBatchExtensionDependencies = {},
) {
	pi.registerTool({
		name: "start_unattended_batch",
		label: "Start unattended batch",
		description: "Start an unattended serial batch run for an Initiative after native confirmation.",
		promptSnippet: "Start unattended batch run: invoke once in foreground after plan confirmation.",
		promptGuidelines: [
			"Call only after plan confirmation; execute once in the foreground and consume the direct terminal result.",
			"Do not run this Tool in background, poll for completion, or issue a cancel subcommand.",
		],
		parameters: Type.Object({
			initiative_slug: Type.String({ pattern: "^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$" }),
			// Integer-ness is enforced by parseMaxParallel before any gate opens.
			max_parallel: Type.Optional(Type.Number({ minimum: 1 })),
			lane_offers: Type.Optional(Type.Array(
				Type.Object({ task_id: Type.String(), path: Type.String() }, { additionalProperties: false }),
			)),
		}, { additionalProperties: false }),
		execute: async (
			_toolCallId: string,
			params: { initiative_slug: string; max_parallel?: number; lane_offers?: Array<{ task_id: string; path: string }> },
			signal: AbortSignal | undefined,
			_onUpdate: unknown,
			ctx: ExtensionContext,
		) => {
			const { initiative_slug: initiativeSlug } = params;
			if (ctx.mode !== "tui") {
				const refusal = nonInteractiveRefusal();
				throwToolFailure({
					tool: "imm_canary_enrollment",
					task_id: initiativeSlug,
					operation: "start_unattended_batch",
					state: "blocked",
					code: "unsupported_host",
					message: refusal.reason,
					next_action: refusal.recovery_action,
				});
			}

			const maxParallel = parseMaxParallel(params.max_parallel);
			const laneOffers = parseLaneOffers(params.lane_offers);
			if (maxParallel === undefined && laneOffers !== undefined)
				throw new Error("lane_offers requires max_parallel");

			const result = await executePiUnattendedBatch({
				root: ctx.cwd,
				initiativeSlug,
				...(maxParallel !== undefined ? { max_parallel: maxParallel } : {}),
				...(laneOffers !== undefined ? { lane_offers: laneOffers } : {}),
				interactive: ctx.mode === "tui",
				signal,
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
								{ value: "confirm", label: "Authorize batch run", description: "Start the unattended serial batch run" },
								{ value: "decline", label: "Decline batch", description: "Reject this batch authorization; repository and authority stay unchanged" },
								{ value: "cancel", label: "Cancel", description: "Leave repository and authority unchanged" },
							],
						},
					);
					return mapDialogSelection(selected);
				},
			});

			if (result.state !== "started") {
				const failureState = result.state === "blocked" ? "blocked" : "failed";
				throwToolFailure({
					tool: "imm_canary_enrollment",
					task_id: initiativeSlug,
					operation: "start_unattended_batch",
					state: failureState,
					code: `batch_${result.state}`,
					message: result.reason,
					next_action: result.recovery_action,
				});
			}

			// review-f72ae870f4f0-2: the Parent consumes the model-visible content, not
			// Tool details, so the full structured result must be serialized there
			// (the same shape imm-canary-work.ts returns). A batch that pauses for
			// Review exposes report.next_action plus review_dispatch, and a
			// needs_human/failed run exposes the parked child reason; without them the
			// Parent cannot launch the reserved foreground Review or recover.
			return {
				content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
				details: result,
			};
		},
		renderCall(args, theme) {
			const params = args as { initiative_slug?: string };
			return renderStructuredCall("start_unattended_batch", "start", params.initiative_slug, theme);
		},
		renderResult(result, _options, theme) {
			return renderStructuredResult(
				result as Parameters<typeof renderStructuredResult>[0],
				theme,
			);
		},
	});
}
