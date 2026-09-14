import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import {
	LITERAL_USER_ACTOR_ID,
	createBatchAuthorityRegistry,
	deriveChildEnrollment,
	startBatch,
	readTaskRecord,
	advancePiTask,
	projectAssuranceForTask,
	runEnrollmentRehearsal,
	enrollCanaryTask,
	createEnrollmentAuthorityRegistry,
	type BatchAuthorityRegistry,
	type BatchAuthorizationBinding,
	type BatchRunnerKernelPort,
	type BatchRunnerGitPort,
	type BatchRunReport,
	type InitiativeObservationReader,
} from "./runtime-stub";
import { batchReason } from "../runtime/unattended/batch_reasons";
import { startConfirmationDeadline } from "../runtime/unattended/confirmation_deadline";
import {
	projectBatchPreflight,
	projectBatchDrift,
	readActiveClaimTaskId,
	isOwnBatchClaim,
	expectedBatchHead,
} from "../runtime/unattended/batch_preflight";
import {
	presentTaskRail,
	presentTaskRailResult,
	renderStructuredCall,
	renderStructuredResult,
	requestAuthorityDialog,
	type UserAttentionReason,
} from "./pi-canary-interaction";
import { isToolFailureState, throwToolFailure } from "./pi-canary-tool-failure";

const INITIATIVE_SLUG_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

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
 * Synchronous re-verification that the currently held claim for `taskId` is this
 * batch's own Kernel enrollment. Positive evidence only: the driver's durable
 * child slot (enrolled/needs_human), the batch Git lineage, the Kernel's own
 * event-id derivation, the intent identity on the TaskRecord, and the claim
 * created before the batch's last durable write. The mutable confirmation_time
 * is deliberately not used, so a needs_human re-authorization (which updates
 * confirmation_time) can never turn this batch's own claim into a foreign one.
 *
 * Called fresh at pre-confirmation, post-confirmation, and from ownsTaskClaim so
 * a claim swapped during confirmation is never adopted.
 */
export interface PiBatchExecutionOptions {
	root: string;
	initiativeSlug: string;
	interactive?: boolean;
	signal?: AbortSignal;
	batchKernel?: Partial<BatchRunnerKernelPort>;
	batchGit?: BatchRunnerGitPort;
	readInitiative?: InitiativeObservationReader;
	/** Environment the confirmation deadline reads; production passes process.env. */
	env?: Record<string, string | undefined>;
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
	const interactive = options.interactive ?? true;

	if (!interactive) {
		return {
			state: "rejected",
			reason: "interactive TUI elicitation is unavailable in non-interactive mode",
			recovery_action: "invoke through an interactive Pi TUI session in the current Host",
		};
	}

	// 1. Host-independent batch preflight: claim ownership, branch availability,
	// working-tree cleanliness against the authorized scope, recovery children,
	// plan digest, and base HEAD are one shared projection, so neither Host
	// re-implements a batch decision.
	const now = new Date().toISOString();
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
	const baseHead = preflight.projection.base_head;
	const budget = preflight.projection.budget;
	const planDigest = preflight.projection.plan_digest;
	const recoveryChildren = preflight.projection.recovery_children;
	const confirmChildrenDetails = recoveryChildren.map((c) => {
		const childRisk = preflight.projection.risk_by_task[c.task_id] ?? "material";
		return c.status === "already_settled"
			? `  - ${c.task_id} (${c.slice_id}) [risk: ${childRisk}] [status: completed]`
			: `  - ${c.task_id} (${c.slice_id}) [risk: ${childRisk}] [status: pending execution]`;
	});
	const confirmExcludedDetails = preflight.projection.excluded.map(
		(c) => `  - ${c.task_id} (${c.slice_id}): ${c.reason}`,
	);

	// ADR-0005 Decision 1: one Batch Authorization spans the work it authorizes,
	// so its expiry is the deadline the literal user confirmed rather than a fixed
	// window that lapses while a child is parked on a foreground Review.
	const isExistingExpired = isResuming && Date.parse(existingBatch!.authorization_expires_at) <= Date.now();
	const expiresAt = isResuming && !isExistingExpired && existingBatch!.batch_state === "running"
		? existingBatch!.authorization_expires_at
		: budget.deadline_at;

	// ADR-0005 Decision 1: a Batch Authorization is one literal-user Enrollment
	// act, so a resume of an intact, still-binding authorization reuses it instead
	// of opening a second native gate. Anything that no longer binds falls through
	// to the gate below, which names the reason and demands the fresh confirmation.
	const reuseBlockers: string[] = [];
	if (isResuming && existingBatch) {
		if (isExistingExpired) reuseBlockers.push("batch_authorization_expired");
		if (existingBatch.batch_state !== "running") reuseBlockers.push("batch_not_running");
		if (existingBatch.plan_digest !== planDigest) reuseBlockers.push("batch_plan_digest_changed");
		if (existingBatch.branch !== batchBranch) reuseBlockers.push("batch_branch_changed");
		if (expectedBatchHead(existingBatch) !== baseHead) reuseBlockers.push("batch_head_lineage_moved");
	}
	const reuseAuthorization = isResuming && reuseBlockers.length === 0;

	// 4. Native confirmation
	const confirmDetails = {
		title: `Authorize Unattended Batch: ${initiativeSlug}`,
		summary: `Initiative: ${initiativeSlug}\nBatch branch: ${batchBranch}\nPlan digest: ${planDigest}\nBudget: max_children=${budget.max_children}, deadline_at=${budget.deadline_at}, qa_failure_limit=${budget.qa_failure_limit}\nExpires at: ${expiresAt}`,
		details: `Ordered children (${recoveryChildren.length}):\n${confirmChildrenDetails.join("\n")}${confirmExcludedDetails.length > 0 ? `\n\nExcluded children:\n${confirmExcludedDetails.join("\n")}` : ""}${reuseBlockers.length > 0 ? `\n\nRe-confirmation required: ${reuseBlockers.join(", ")}.\nRecovery: confirm to issue a fresh authorization bound to the current plan and HEAD.` : ""}`,
		planDigest,
		signal,
	};

	let decision: "accept" | "decline" | "cancel" = "accept";
	if (!reuseAuthorization) {
		// review-2: fail closed with zero writes when confirmation port is missing
		if (!options.confirmBatch) {
			return batchReason("confirmation_port_unavailable");
		}

		// The bounded elicitation deadline is shared behavior: an unanswered native
		// confirmation is bounded by the same setting on both Hosts.
		const deadline = startConfirmationDeadline({ env: options.env ?? process.env, signal });
		try {
			decision = await options.confirmBatch({ ...confirmDetails, signal: deadline.signal });
		} catch (err) {
			if (deadline.timedOut()) return batchReason("confirmation_timed_out");
			if (signal?.aborted) return batchReason("confirmation_cancelled");
			return batchReason("confirmation_failed", err instanceof Error ? err.message : String(err));
		} finally {
			deadline.clear();
		}

		if (deadline.timedOut()) return batchReason("confirmation_timed_out");
		if (decision === "cancel" || signal?.aborted) {
			return batchReason("confirmation_cancelled");
		}
		if (decision === "decline") {
			return batchReason("confirmation_declined");
		}
		if (decision !== "accept") {
			return batchReason("confirmation_no_decision");
		}
	}

	// 5. Post-confirmation revalidation: the same shared decisions, re-verified
	// after the native gate and after the asynchronous plan read.
	const postActiveTaskId = readActiveClaimTaskId(root);
	// Re-verify the full claim identity now, not the pre-confirmation snapshot: a
	// claim swapped for the same child during confirmation must stay blocked.
	const postIsOwnClaim =
		isResuming && postActiveTaskId !== null && isOwnBatchClaim(root, existingBatch!, postActiveTaskId, batchBranch);
	if (postActiveTaskId && !postIsOwnClaim) {
		return batchReason("claim_appeared_during_confirmation", postActiveTaskId);
	}

	const drift = await projectBatchDrift({
		root,
		initiative_slug: initiativeSlug,
		now,
		readInitiative: options.readInitiative,
	});
	if (!drift.plan_digest) {
		return batchReason("plan_became_unreadable");
	}
	if (drift.plan_digest !== planDigest) {
		return batchReason("plan_changed");
	}
	if (drift.base_head === null) {
		return batchReason("repository_became_unreadable");
	}
	if (drift.base_head !== baseHead) {
		return batchReason("head_moved");
	}

	// review-f72ae870f4f0-1: re-check the workspace claim AFTER the async plan
	// revalidation finishes. The earlier check ran before that await, so a foreign
	// enrollment completing during the Initiative read would otherwise reach
	// authority issuance and let startBatch create the branch and batch state,
	// while Claude returns blocked. Same check, same order, same reason as Claude.
	const finalActiveTaskId = readActiveClaimTaskId(root);
	const finalIsOwnClaim =
		isResuming &&
		finalActiveTaskId !== null &&
		isOwnBatchClaim(root, existingBatch!, finalActiveTaskId, batchBranch);
	if (finalActiveTaskId && !finalIsOwnClaim) {
		return batchReason("claim_appeared_during_confirmation", finalActiveTaskId);
	}

	// 6. Issue Batch Authorization through Kernel registry and startBatch
	const batchRegistry: BatchAuthorityRegistry = await createBatchAuthorityRegistry();
	const enrollmentRegistry = await createEnrollmentAuthorityRegistry();

	// review-2: verify cancellation signal right before authority issuance and startBatch
	if (signal?.aborted) return batchReason("cancelled_before_execution");

	const batchId = existingBatch ? existingBatch.batch_id : `batch-${initiativeSlug}-${Date.now()}`;
	const confirmation = piConfirmationRef({
		toolCallId: `call-${batchId}`,
		requestId: randomUUID(),
		operation: "start_unattended_batch",
		initiativeSlug,
		planDigest,
	});

	const binding: BatchAuthorizationBinding = {
		batch_id: batchId,
		initiative_slug: initiativeSlug,
		plan_digest: planDigest,
		branch: batchBranch,
		base_head: existingBatch ? existingBatch.base_head : baseHead,
		budget,
		actor_id: LITERAL_USER_ACTOR_ID,
		confirmation_ref: confirmation,
		expires_at: expiresAt,
		nonce: randomUUID(),
	};

	const capability = batchRegistry.issue(binding, recoveryChildren as any, now);

	let activeReviewDispatch: { operation_id: string; agent_params: Record<string, unknown> } | null = null;

	const realPort: BatchRunnerKernelPort = {
		enrollTask: async ({ root: taskRoot, task_id, batch: b }) => {
			const derived = await deriveChildEnrollment(taskRoot, b.registry, {
				capability: b.capability,
				binding,
				task_id,
				expected_head: b.binding.expected_head,
				now,
			});
			const enrollmentCapability = enrollmentRegistry.issue(derived.binding);
			const input = {
				task_id,
				intent_path: derived.binding.intent_path,
				intent_revision: derived.binding.intent_revision,
				preparation_digest: derived.binding.preparation_digest,
				capability: enrollmentCapability,
				capability_binding: derived.binding,
				batch: {
					registry: b.registry,
					capability: b.capability,
					binding,
					expected_head: b.binding.expected_head,
				},
				now,
			};
			const rehearsal = await runEnrollmentRehearsal(taskRoot, input, enrollmentCapability, enrollmentRegistry);
			if (!rehearsal.rehearsed || rehearsal.evidence.outcome !== "ready") {
				throw new Error(`Kernel enrollment rehearsal failed: ${rehearsal.evidence.blockers.join("; ")}`);
			}
			await enrollCanaryTask(taskRoot, input, enrollmentRegistry);
			const recordRaw = await readTaskRecord(taskRoot, task_id);
			return { record_revision: recordRaw.revision };
		},
		advanceTask: async (taskRoot, taskId) => {
			const res = await advancePiTask(taskRoot, taskId);
			if (res.state === "review_ready" && res.agent_params) {
				activeReviewDispatch = {
					operation_id: res.operation_id,
					agent_params: res.agent_params,
				};
			}
			return res;
		},
		projectTask: async (taskRoot, taskId) => {
			return projectAssuranceForTask(taskRoot, taskId);
		},
		ownsTaskClaim: (taskId) => {
			if (isResuming && taskId === readActiveClaimTaskId(root)) {
				// Re-verify the CURRENT claim identity synchronously: a claim swapped
				// during confirmation is never adopted.
				return isOwnBatchClaim(root, existingBatch!, taskId, batchBranch);
			}
			return batchRegistry.isChildConsumed(capability, taskId);
		},
		validateBatchAuthorization: (input) => input.registry.inspect(input.capability, input.binding as never),
	};

	const rawAdvance = options.batchKernel?.advanceTask ?? realPort.advanceTask;
	const wrappedAdvance: typeof realPort.advanceTask = async (taskRoot, taskId) => {
		const res = (await rawAdvance(taskRoot, taskId)) as any;
		if (res.state === "review_ready" && res.agent_params) {
			activeReviewDispatch = {
				operation_id: res.operation_id,
				agent_params: res.agent_params,
			};
		}
		return res;
	};

	const kernelPort: BatchRunnerKernelPort = {
		...realPort,
		...(options.batchKernel ?? {}),
		advanceTask: wrappedAdvance,
	};

	const report = await startBatch({
		root,
		batch_id: batchId,
		initiative_slug: initiativeSlug,
		registry: batchRegistry,
		capability,
		children: recoveryChildren,
		plan_digest: planDigest,
		base_head: existingBatch ? existingBatch.base_head : baseHead,
		confirmation_time: now,
		authorization_expires_at: expiresAt,
		budget,
		now,
		kernel: kernelPort,
		git: options.batchGit,
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
		}, { additionalProperties: false }),
		execute: async (
			_toolCallId: string,
			params: { initiative_slug: string },
			signal: AbortSignal | undefined,
			_onUpdate: unknown,
			ctx: ExtensionContext,
		) => {
			const { initiative_slug: initiativeSlug } = params;
			if (ctx.mode !== "tui") {
				throwToolFailure({
					tool: "imm_canary_enrollment",
					task_id: initiativeSlug,
					operation: "start_unattended_batch",
					state: "blocked",
					code: "unsupported_host",
					message: "interactive TUI elicitation is unavailable in non-interactive mode",
					next_action: "invoke through an interactive Pi TUI session in the current Host",
				});
			}

			const result = await executePiUnattendedBatch({
				root: ctx.cwd,
				initiativeSlug,
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
