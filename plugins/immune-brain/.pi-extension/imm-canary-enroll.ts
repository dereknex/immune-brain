// Foreground Enrollment extension.
// The sole production enrollment authority route is the Parent-invoked
// `imm_canary_enrollment` Tool, whose execute callback owns preparation through
// terminal settlement. Host cancellation applies to every pre-commit stage;
// after the explicit commit linearization point, Kernel settlement is
// non-cancellable.

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { createHash, randomUUID } from "node:crypto";
import { resolve } from "node:path";
// The Kernel runtime graph is never type-checked from this extension: static
// imports resolve to ./runtime-stub.ts (relative so the Pi extension loader
// can resolve them at runtime), and the stub forwards to the real Kernel
// modules via dynamic import.
import {
	createEnrollmentAuthorityRegistry,
	preparePiCanary,
	revalidatePiCanary,
	evaluateCanaryEligibility,
	reconcileKernelAuthority,
	readTaskIntent,
	runEnrollmentRehearsal,
	enrollCanaryTask,
	withKernelStoreLock,
	inspectStorageLayout,
	migrateLegacyLayout,
} from "./runtime-stub";
import {
	presentTaskRail,
	presentTaskRailResult,
	renderStructuredCall,
	renderStructuredResult,
	requestAuthorityDialog,
	resetInteractionPresentation,
	type UserAttentionReason,
} from "./pi-canary-interaction";
import { isToolFailureState, throwToolFailure } from "./pi-canary-tool-failure";

const TASK_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export function assertTaskIntentPreparationStable(
	preflight: { content_hash: string },
	preparation: { intent: { content_hash: string } | null },
): void {
	if (preparation.intent?.content_hash !== preflight.content_hash)
		throw new Error("TaskIntent changed during preparation; retry enrollment");
}

async function requestEnrollmentConfirmation(
	pi: Pick<ExtensionAPI, "events">,
	ctx: ExtensionContext,
	taskId: string,
	reason: UserAttentionReason,
	title: string,
	summary: string,
	details: string,
	signal: AbortSignal,
): Promise<boolean> {
	presentTaskRail(ctx, {
		task_id: taskId,
		state: "Approval required",
		result: title,
		next: "Review enrollment evidence",
	});
	const selected = await requestAuthorityDialog(pi, ctx, {
		attention_id: randomUUID(),
		task_id: taskId,
		reason,
		label: title,
	}, {
		title,
		summary,
		details,
		signal,
		actions: [
			{ value: "confirm", label: "Confirm enrollment", description: "Create the Kernel-managed task" },
			{ value: "cancel", label: "Cancel", description: "Leave planning artifacts and authority unchanged" },
		],
	});
	return selected === "confirm";
}

interface ActiveForegroundEnrollment {
	taskId: string;
	controller: AbortController;
	committing: boolean;
	completion: Promise<EnrollmentTerminal>;
}

export type EnrollmentAction = "new";
export type EnrollmentTerminalState =
	| "completed"
	| "blocked"
	| "rejected"
	| "cancelled"
	| "failed"
	| "settlement_unknown"
	| "route_incumbent"
	| "repair_authorization_required"
	| "authority_conflict";

export interface EnrollmentTerminal extends Record<string, unknown> {
	contract: "assurance_kernel/enrollment_tool_result/v1";
	state: EnrollmentTerminalState;
	action: EnrollmentAction;
	task_id: string;
	stage: string;
	summary: string;
	next_action: string;
}

function terminal(
	action: EnrollmentAction,
	taskId: string,
	state: EnrollmentTerminalState,
	stage: string,
	summary: string,
	nextAction: string,
): EnrollmentTerminal {
	return {
		contract: "assurance_kernel/enrollment_tool_result/v1",
		state,
		action,
		task_id: taskId,
		stage,
		summary: summary.slice(0, 4_096),
		next_action: nextAction,
	};
}

function enrollmentToolResult(details: EnrollmentTerminal | Record<string, unknown>) {
	const summary = typeof details.summary === "string" ? details.summary : "Enrollment update";
	return { content: [{ type: "text" as const, text: summary }], details };
}

export class ForegroundEnrollmentCoordinator {
	private active: ActiveForegroundEnrollment | undefined;
	private shuttingDown = false;

	async run(
		action: EnrollmentAction,
		taskId: string,
		hostSignal: AbortSignal | undefined,
		work: (signal: AbortSignal, beginCommit: () => boolean) => Promise<EnrollmentTerminal>,
	): Promise<EnrollmentTerminal> {
		if (this.shuttingDown)
			return terminal(action, taskId, "blocked", "preparing", "Enrollment cannot start during session shutdown", "retry in an active TUI session");
		if (this.active)
			return terminal(
				action,
				taskId,
				"blocked",
				"preparing",
				`Enrollment already runs in foreground for ${this.active.taskId}`,
				"wait for the active foreground Tool call to settle",
			);

		const controller = new AbortController();
		const placeholder = Promise.resolve(
			terminal(action, taskId, "failed", "preparing", "Enrollment did not start", "inspect the Tool result"),
		);
		const slot: ActiveForegroundEnrollment = {
			taskId,
			controller,
			committing: false,
			completion: placeholder,
		};
		this.active = slot;
		const relayAbort = () => {
			if (this.active !== slot || slot.committing || controller.signal.aborted) return;
			controller.abort(
				hostSignal?.reason instanceof Error
					? hostSignal.reason
					: new Error("foreground enrollment cancelled by host"),
			);
		};
		hostSignal?.addEventListener("abort", relayAbort, { once: true });
		if (hostSignal?.aborted) relayAbort();

		const beginCommit = (): boolean => {
			if (this.active !== slot || controller.signal.aborted) return false;
			slot.committing = true;
			return true;
		};
		const completion = work(controller.signal, beginCommit);
		slot.completion = completion;
		try {
			return await completion;
		} finally {
			hostSignal?.removeEventListener("abort", relayAbort);
			if (this.active === slot) this.active = undefined;
		}
	}

	async shutdown(): Promise<void> {
		this.shuttingDown = true;
		const active = this.active;
		if (!active) return;
		if (!active.committing && !active.controller.signal.aborted)
			active.controller.abort(new Error("Pi session shutdown"));
		await active.completion.catch(() => undefined);
	}
}

function updateResult(
	action: EnrollmentAction,
	taskId: string,
	stage: string,
	summary: string,
): ReturnType<typeof enrollmentToolResult> {
	return enrollmentToolResult({
		contract: "assurance_kernel/enrollment_tool_progress/v1",
		state: "running",
		action,
		task_id: taskId,
		stage,
		summary,
	});
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

async function classifyCommitFailure(
	root: string,
	action: EnrollmentAction,
	taskId: string,
	now: string,
	error: unknown,
): Promise<EnrollmentTerminal> {
	const failure = errorMessage(error);
	try {
		const current = await preparePiCanary(root, { task_id: taskId, now });
		if (
			current.backend_claim.present
			&& current.backend_claim.task_id === taskId
			&& current.task_record_v3?.present
			&& current.workspace.current_working === taskId
		) {
			return terminal(
				action,
				taskId,
				"completed",
				"committing",
				`Kernel enrollment committed for ${taskId}; terminal receipt was recovered from authoritative owners`,
				"continue with imm-loop",
			);
		}
		if (
			!current.backend_claim.present
			&& !current.task_record_v3?.present
			&& current.workspace.current_working === null
		) {
			return terminal(
				action,
				taskId,
				"failed",
				"committing",
				`Kernel enrollment failed with no committed owner state: ${failure}`,
				"correct the reported final-lock failure and retry",
			);
		}
	} catch {
		// A contradictory or unreadable owner projection cannot prove settlement.
	}
	return terminal(
		action,
		taskId,
		"settlement_unknown",
		"committing",
		`Kernel enrollment settlement is unknown after commit started: ${failure}`,
		"inspect authoritative Kernel status before any retry",
	);
}

async function executeForegroundEnrollment(
	root: string,
	action: EnrollmentAction,
	taskId: string,
	signal: AbortSignal,
	beginCommit: () => boolean,
	onUpdate: ((update: ReturnType<typeof enrollmentToolResult>) => void) | undefined,
	ctx: ExtensionContext,
	registry: Awaited<ReturnType<typeof createEnrollmentAuthorityRegistry>>,
	pi: Pick<ExtensionAPI, "events">,
): Promise<EnrollmentTerminal> {
	let stage = "preparing";
	const progress = (nextStage: string, summary: string) => {
		stage = nextStage;
		const update = updateResult(action, taskId, nextStage, summary);
		onUpdate?.(update);
		presentTaskRailResult(ctx, taskId, update.details);
	};
	const cancelled = () => terminal(
		action,
		taskId,
		"cancelled",
		stage,
		`Foreground enrollment cancelled during ${stage}; zero authority writes were requested`,
		"retry by invoking the launcher again",
	);

	try {
		signal.throwIfAborted();
		progress("preparing", `Preparing immutable Kernel owners for ${taskId}`);
		const now = new Date().toISOString();
		let taskIntent: Awaited<ReturnType<typeof readTaskIntent>>;

		// Storage-layout gate (BR-REQ-005/006): enrollment is the stateful
		// mutation boundary. Kernel transaction markers recover under the
		// store lock; the one-release migrator relocates an owner-free legacy
		// layout and stops, and the literal user retries after committing the
		// affected migration diff. Repreparation never proceeds on a dirty
		// or blocked layout.
		{
			const recoverLayout = async (): Promise<
				EnrollmentTerminal | undefined
			> => {
				try {
					await withKernelStoreLock(root, () => undefined);
				} catch (error) {
					return terminal(
						action,
						taskId,
						"blocked",
						stage,
						`Kernel transaction recovery failed before enrollment: ${errorMessage(error)}`,
						"resolve the pending Kernel transaction marker and retry",
					);
				}
				const inspection = await inspectStorageLayout(root);
				if (inspection.layout === "ready") return undefined;
				if (
					inspection.layout === "migration_required" ||
					inspection.layout === "recovery_required"
				) {
					const migration = await migrateLegacyLayout(root);
					if (migration.outcome === "migrated")
						return terminal(
							action,
							taskId,
							"blocked",
							stage,
							`Legacy storage migrated (${migration.affected_paths.length} paths); commit the affected migration diff and retry enrollment`,
							"commit .imm/audit/** and .imm/legacy paths, then retry",
						);
					if (migration.outcome === "migration_uncommitted")
						return terminal(
							action,
							taskId,
							"blocked",
							stage,
							`Migration completed but affected paths are uncommitted: ${migration.affected_paths.join(", ")}`,
							"commit the affected migration diff, then retry",
						);
					return terminal(
						action,
							taskId,
						"blocked",
						stage,
						`Enrollment blocked by storage layout (${migration.outcome}): ${migration.reason ?? inspection.reason ?? ""}`,
						"resolve the reported layout condition and retry",
					);
				}
				return terminal(
					action,
					taskId,
					"blocked",
					stage,
					`Enrollment blocked by storage layout (${inspection.layout}): ${inspection.reason ?? ""}`,
					"resolve the reported layout condition and retry",
				);
			};
			const blocked = await recoverLayout();
			if (blocked) return blocked;
		}

		try {
			taskIntent = await readTaskIntent(root, taskId);
		} catch (error) {
			const message = errorMessage(error);
			// `readTaskIntent` reports an absent sidecar semantically now, so the
			// "missing" classification must recognise that wording as well as the raw
			// filesystem errors; otherwise a missing file is misreported as a schema
			// defect and the operator is told to repair fields that do not exist.
			if (/not Git-tracked|ENOENT|no such file|sidecar is missing/i.test(message))
				return terminal(action, taskId, "blocked", stage, "A Git-tracked TaskIntent is required for Kernel enrollment", "author and stage the canonical TaskIntent");
			return terminal(action, taskId, "blocked", stage, `TaskIntent validation failed before rehearsal: ${message}`, "repair the reported TaskIntent schema errors");
		}
		const authority = await reconcileKernelAuthority(root, taskId);
		if (authority.state === "active_owner")
			return terminal(
				action,
				taskId,
				"route_incumbent",
				stage,
				`Kernel task ${authority.owner_task_id} already owns this workspace`,
				`continue ${authority.owner_task_id} through imm-loop without re-enrollment`,
			);
		if (authority.state === "repairable_stale_claim")
			return terminal(
				action,
				taskId,
				"repair_authorization_required",
				stage,
				`Terminal task ${authority.owner_task_id} retains an exactly proven stale backend claim`,
				`invoke imm_kernel_canary repair_authority_state for ${authority.owner_task_id}`,
			);
		if (authority.state === "authority_conflict" || authority.state === "terminal_owner")
			return terminal(
				action,
				taskId,
				"authority_conflict",
				stage,
				authority.diagnostic ?? `Kernel authority state is ${authority.state}`,
				"inspect authority state; do not retry enrollment",
			);
		const preparation = await preparePiCanary(root, { task_id: taskId, now });
		signal.throwIfAborted();
		if (!preparation.intent)
			return terminal(action, taskId, "blocked", stage, "A Git-tracked TaskIntent is required for Kernel enrollment", "author and stage the canonical TaskIntent");
		try {
			assertTaskIntentPreparationStable(taskIntent, preparation);
		} catch (error) {
			return terminal(action, taskId, "blocked", stage, errorMessage(error), "retry enrollment from the launcher");
		}
		if (
			action === "new"
			&& (preparation.backend_claim.present || preparation.task_record_v3?.present)
		)
			return terminal(action, taskId, "blocked", stage, `Task ${taskId} is already owned by the Kernel backend`, "continue the existing Kernel task");
		if (action === "new" && preparation.workspace.current_working !== null)
			return terminal(action, taskId, "blocked", stage, `Workspace is owned by ${preparation.workspace.current_working}`, "finish or stop the current owner first");

		const eligibility = await evaluateCanaryEligibility({
			task: {
				id: taskId,
				intent_path: preparation.intent.path,
				intent_revision: preparation.intent.revision,
				intent_content_hash: preparation.intent.content_hash,
			},
			now,
		});
		if (!eligibility.eligible) {
			const reasons = [...eligibility.rejections, ...eligibility.unmet_non_waivable].join("; ");
			return terminal(action, taskId, "blocked", stage, `Enrollment is ineligible: ${reasons}`, "resolve the eligibility blockers");
		}

		const acceptanceDetails = taskIntent.intent.acceptance.length === 0
			? "(none)"
			: taskIntent.intent.acceptance
				.map((item) => `${item.id}: ${item.assertion} [verification: ${item.verification}]`)
				.join("\n");
		// Enrollment binds authority to the validated intent. Acceptance descriptors
		// execute only during post-implementation deterministic QA.
		const confirmedContentHash = preparation.intent.content_hash;
		{
			const confirmationSummary = [
				`Task: ${taskId}`,
				`Goal: ${taskIntent.intent.goal}`,
				`Risk: ${taskIntent.intent.risk}`,
				`Scope: ${taskIntent.intent.scope_hint.length > 0 ? taskIntent.intent.scope_hint.join(", ") : "(none)"}`,
				`Acceptance: ${taskIntent.intent.acceptance.length} descriptor(s)`,
			].join("\n");
			const confirmationDetails = [
				`Acceptance descriptors:`,
				acceptanceDetails,
				`Preparation digest: ${preparation.digest}`,
				`Intent digest: ${preparation.intent.content_hash}`,
				`Intent: ${preparation.intent.path} @ rev ${preparation.intent.revision}`,
				`Owners: intent+workspace+claim+record checked`,
				`Route: Kernel enrollment`,
			].join("\n");
			progress("awaiting_confirmation", "Waiting for exact literal-user confirmation");
			const confirmed = await requestEnrollmentConfirmation(
				pi,
				ctx,
				taskId,
				"enrollment",
				"Create Kernel-managed task?",
				confirmationSummary,
				confirmationDetails,
				signal,
			);
			if (signal.aborted) return cancelled();
			if (!confirmed)
				return terminal(action, taskId, "rejected", stage, "Enrollment confirmation was rejected; zero authority writes were requested", "invoke the launcher again only if enrollment is still intended");
		}
		{
			let liveEarly: string | null = null;
			try {
				liveEarly = (await readTaskIntent(resolve(root), taskId)).content_hash;
			} catch {
				liveEarly = null;
			}
			if (liveEarly !== confirmedContentHash)
				return terminal(action, taskId, "blocked", stage, "Intent changed after confirmation; enrollment aborted before authority", "restore the intended snapshot and rerun enrollment");
		}

		{
			let liveContentHash: string | null = null;
			try {
				liveContentHash = (await readTaskIntent(resolve(root), taskId)).content_hash;
			} catch {
				liveContentHash = null;
			}
			if (liveContentHash !== confirmedContentHash)
				return terminal(action, taskId, "blocked", stage, "Intent changed after confirmation; enrollment aborted before authority", "restore the intended snapshot and rerun enrollment");
		}

		progress("revalidating", "Revalidating immutable owners and the confirmed TaskIntent");
		const { unchanged } = await revalidatePiCanary(root, { task_id: taskId, now }, preparation);
		if (!unchanged)
			return terminal(action, taskId, "blocked", stage, "Workspace changed after confirmation; enrollment aborted before authority", "restore the intended snapshot and rerun enrollment");
		signal.throwIfAborted();

		const nonce = randomUUID();
		const binding = {
			task_id: taskId,
			intent_path: preparation.intent.path,
			intent_revision: preparation.intent.revision,
			intent_content_hash: preparation.intent.content_hash,
			preparation_digest: preparation.digest,
			actor_id: "user",
			confirmation_ref: `pi-confirm-${createHash("sha256").update(`${taskId}\0${now}\0${nonce}`).digest("hex").slice(0, 16)}`,
			expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
			nonce,
		};
		const capability = registry.issue(binding);
		const input = {
			task_id: taskId,
			intent_path: binding.intent_path,
			intent_revision: binding.intent_revision,
			preparation_digest: binding.preparation_digest,
			capability,
			capability_binding: binding,
			now,
		};

		progress("rehearsing", "Running the zero-write Kernel owner rehearsal");
		const rehearsal = await runEnrollmentRehearsal(root, input, capability, registry);
		if (!rehearsal.rehearsed || rehearsal.evidence.outcome !== "ready")
			return terminal(action, taskId, "failed", stage, `Kernel enrollment rehearsal failed: ${rehearsal.evidence.blockers.join("; ")}`, "resolve the final-lock preconditions and retry");
		if (signal.aborted) return cancelled();
		if (!beginCommit()) return cancelled();

		stage = "committing";
		onUpdate?.(updateResult(action, taskId, stage, "Kernel enrollment commit owns settlement and is no longer cancellable"));
		try {
			const result = await enrollCanaryTask(root, input, registry);
			return terminal(
				action,
				taskId,
				"completed",
				stage,
				`Kernel enrollment completed: task ${result.record.task_id} state=${result.record.lifecycle}:${result.record.artifact_state} backend=${result.backend_claim.backend}`,
				"continue with imm-loop",
			);
		} catch (error) {
			return classifyCommitFailure(root, action, taskId, now, error);
		}
	} catch (error) {
		if (signal.aborted) return cancelled();
		return terminal(action, taskId, "failed", stage, `Foreground enrollment failed during ${stage}: ${errorMessage(error)}`, "correct the reported failure and retry");
	}
}

export default function (pi: ExtensionAPI) {
	const coordinator = new ForegroundEnrollmentCoordinator();
	let registryPromise: ReturnType<typeof createEnrollmentAuthorityRegistry> | undefined;
	const registry = () => registryPromise ??= createEnrollmentAuthorityRegistry();

	pi.registerTool({
		name: "imm_canary_enrollment",
		label: "Foreground Kernel enrollment",
		description: "Run one exact Kernel new-task enrollment synchronously in the foreground with host cancellation before authority commit.",
		promptSnippet: "Kernel enrollment: invoke once in foreground and consume the direct terminal result.",
		promptGuidelines: [
			"Call from the Parent after natural-language routing selects Enrollment; execute once in the foreground and consume the terminal Tool result.",
			"Do not run this Tool in background, poll for completion, or issue a cancel subcommand; host cancellation is the only pre-commit cancellation path.",
		],
		parameters: Type.Object(
			{
				action: Type.Literal("new"),
				task_id: Type.String({ pattern: "^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$" }),
			},
			{ additionalProperties: false },
		),
		execute: async (
			_toolCallId: string,
			params: { action: EnrollmentAction; task_id: string },
			signal: AbortSignal | undefined,
			onUpdate: ((update: ReturnType<typeof enrollmentToolResult>) => void) | undefined,
			ctx: ExtensionContext,
		) => {
			const { action, task_id: taskId } = params;
			if (action !== "new" || !TASK_ID_PATTERN.test(taskId))
				throwToolFailure({
					tool: "imm_canary_enrollment",
					task_id: taskId,
					operation: action,
					state: "blocked",
					code: "invalid_request",
					message: `invalid task id or enrollment action: ${taskId}`,
					next_action: "invoke the launcher with one canonical task id",
				});
			if (ctx.mode !== "tui")
				throwToolFailure({
					tool: "imm_canary_enrollment",
					task_id: taskId,
					operation: action,
					state: "blocked",
					code: "tui_required",
					message: "imm_canary_enrollment is TUI-only",
					next_action: "invoke the TUI launcher",
				});
			const authorityRegistry = await registry();
			const result = await coordinator.run(action, taskId, signal, (foregroundSignal, beginCommit) =>
				executeForegroundEnrollment(
					ctx.cwd,
					action,
					taskId,
					foregroundSignal,
					beginCommit,
					onUpdate,
					ctx,
					authorityRegistry,
					pi,
				));
			const rendered = enrollmentToolResult(result);
			presentTaskRailResult(ctx, taskId, rendered.details);
			if (isToolFailureState(result.state))
				throwToolFailure({
					tool: "imm_canary_enrollment",
					task_id: taskId,
					operation: action,
					state: result.state,
					code: `enrollment_${result.state}`,
					message: result.summary,
					next_action: result.next_action,
				});
			return rendered;
		},
		renderCall(args, theme) {
			const params = args as { action?: string; task_id?: string };
			return renderStructuredCall(
				"imm_canary_enrollment",
				params.action ?? "unknown",
				params.task_id,
				theme,
			);
		},
		renderResult(result, _options, theme) {
			return renderStructuredResult(
				result as Parameters<typeof renderStructuredResult>[0],
				theme,
			);
		},
	});

	if (typeof pi.on === "function")
		pi.on("session_shutdown", async (_event, ctx) => {
			resetInteractionPresentation(ctx);
			await coordinator.shutdown();
		});
}
