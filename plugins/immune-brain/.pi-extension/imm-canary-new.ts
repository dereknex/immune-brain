// P2C Pi extension: /imm-canary-new <task-id>
// The DEFAULT route for creating a new managed task on the Pi host: Kernel
// lifecycle enrollment with a no-waiver candidate gate.
// - TUI only: ctx.mode === "tui" is required before any readiness read or confirm.
// - Reuses the P2B1 enrollment machinery (prepare -> eligibility -> descriptor
//   rehearsal -> confirm -> revalidate -> Kernel rehearsal -> atomic enroll)
//   with one difference: descriptor and eligibility failures reject WITHOUT a
//   waiver before any confirmation UI.
// - After enrollment the route reports the read-only projection and directs
//   the session to imm-canary-work.
// - Never auto-creates a task, never changes v3 routing for existing tasks.
//
// v4 storage retirement: preparation derives its digest exclusively from
// Kernel owners (intent, workspace, claim, TaskRecord v2, tombstone). The
// capability binds `preparation_digest`; the legacy readiness/evidence fields
// are retained only as compatibility mirrors in the claim schema and are
// never read as authority.

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createHash } from "node:crypto";
// The Kernel runtime graph is never type-checked from this extension: static
// imports resolve to ./runtime-stub.ts (relative so the Pi extension loader
// can resolve them at runtime), and the stub forwards to the real Kernel
// modules via dynamic import.
import {
	createEnrollmentAuthorityRegistry,
	preparePiCanary,
	revalidatePiCanary,
	evaluateCanaryEligibility,
	runEnrollmentRehearsal,
	enrollCanaryTask,
} from "./runtime-stub";
import type { PiCanaryPreparation, PiCanaryPrepareInput } from "./runtime-stub";
import {
	assertDescriptorRehearsalSnapshot,
	decideDescriptorRehearsalRoute,
	descriptorRehearsalDigest,
	descriptorRehearsalReceiptRef,
	descriptorRehearsalSummary,
	enrollmentCoordinatorFor,
	isBackgroundEnrollmentContext,
	runDescriptorRehearsal,
	type DescriptorRehearsalReceipt,
} from "./imm-canary-enroll";

const TASK_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export default function (pi: ExtensionAPI) {
	const coordinator = enrollmentCoordinatorFor(pi);
	const handler = async (args: string, ctx: ExtensionContext): Promise<void> => {
			// 1. TUI-only gate before ANY readiness read or prompt.
			if (ctx.mode !== "tui") {
				ctx.ui.notify("imm-canary-new is TUI-only and was rejected", "warning");
				return;
			}
			const rawArgs = (args || "").trim();
			const cancelMatch = /^cancel\s+(.+)$/.exec(rawArgs);
			if (cancelMatch) {
				const cancelledTaskId = cancelMatch[1].trim();
				if (!TASK_ID_PATTERN.test(cancelledTaskId)) {
					ctx.ui.notify(`invalid task id: ${cancelledTaskId}`, "error");
					return;
				}
				coordinator.cancel(cancelledTaskId, ctx);
				return;
			}
			const taskId = rawArgs;
			if (!TASK_ID_PATTERN.test(taskId)) {
				ctx.ui.notify(`invalid task id: ${taskId}`, "error");
				return;
			}
			if (
				!isBackgroundEnrollmentContext(ctx) &&
				typeof ctx.ui.setWidget === "function"
			) {
				coordinator.start(taskId, "imm-canary-new", ctx, (backgroundCtx) =>
					handler(taskId, backgroundCtx));
				return;
			}

			// Production enrollment authority registry: created only here,
			// never exported.
			const registry = await createEnrollmentAuthorityRegistry();

			const now = new Date().toISOString();

			// 2. Read-only preparation. Missing/invalid evidence or a
			//    non-candidate readiness must reject here, before any
			//    confirmation UI.
			let preparation: PiCanaryPreparation;
			try {
				preparation = await preparePiCanary(ctx.cwd, { task_id: taskId, now });
			} catch (error) {
				ctx.ui.notify(
					`cannot prepare canary enrollment: ${error instanceof Error ? error.message : String(error)}`,
					"error",
				);
				return;
			}
			if (!preparation.intent) {
				ctx.ui.notify(
					"new-task creation blocked: a Git-tracked TaskIntent is required for Kernel enrollment",
					"error",
				);
				return;
			}
			if (preparation.backend_claim.present || preparation.task_record_v2?.present) {
				ctx.ui.notify(
					`new-task creation blocked: task ${taskId} is already owned by the Kernel backend`,
					"error",
				);
				return;
			}
			if (preparation.workspace.current_working !== null) {
				ctx.ui.notify(
					`new-task creation blocked: workspace is owned by ${preparation.workspace.current_working}`,
					"error",
				);
				return;
			}

			// 3. Eligibility WITHOUT a waiver: the candidate epoch must make
			//    the task eligible on its own; a waiver is never minted here.
			const eligibility = await evaluateCanaryEligibility({
				task: {
					id: taskId,
					intent_path: preparation.intent?.path ?? `docs/plans/${taskId}.intent.json`,
					intent_revision: preparation.intent?.revision ?? 1,
					intent_content_hash: preparation.intent?.content_hash ?? "",
				},
				now,
			});
			if (!eligibility.eligible) {
				const reasons = [...eligibility.rejections, ...eligibility.unmet_non_waivable].join("; ");
				ctx.ui.notify(`new-task creation ineligible: ${reasons}`, "error");
				return;
			}

			// 4. The default route requires a passing concurrent descriptor rehearsal
			//    and never offers a waiver. Failures block before confirmation.
			coordinator.updateStage(taskId, "descriptor rehearsal");
			let descriptorRehearsal: DescriptorRehearsalReceipt;
			try {
				descriptorRehearsal = await runDescriptorRehearsal(ctx.cwd, taskId, { signal: ctx.signal });
			} catch (error) {
				ctx.ui.notify(
					`descriptor rehearsal unavailable: ${error instanceof Error ? error.message : String(error)}`,
					"error",
				);
				return;
			}
			const rehearsalDecision = decideDescriptorRehearsalRoute(descriptorRehearsal, "default");
			if (!rehearsalDecision.proceed_to_confirmation) {
				ctx.ui.notify(
					descriptorRehearsal.waiver_allowed
						? `new-task descriptor rehearsal blocked enrollment_ready: ${descriptorRehearsal.blockers.join("; ")}. Use /imm-canary-enroll only to present an explicit literal-user waiver.`
						: `new-task descriptor rehearsal integrity blocked enrollment and cannot be waived: ${descriptorRehearsal.blockers.join("; ")}`,
					"error",
				);
				return;
			}
			assertDescriptorRehearsalSnapshot(ctx.cwd, descriptorRehearsal);
			const rehearsalDigest = descriptorRehearsalDigest(descriptorRehearsal);
			const rehearsalReceiptRef = descriptorRehearsalReceiptRef(descriptorRehearsal, false);

			// 5. Exact-task confirmation summary.
			const summary = [
				`Task: ${taskId}`,
				`Intent: ${preparation.intent?.path ?? "(missing)"} @ rev ${preparation.intent?.revision ?? "?"}`,
				`Content hash: ${preparation.intent?.content_hash ?? "?"}`,
				`Owners: intent+workspace+claim+record checked`,
				`Descriptor rehearsal (${rehearsalDigest}):`,
				descriptorRehearsalSummary(descriptorRehearsal),
				`Rehearsal: enrollment_ready=true`,
				`Route: Kernel default (imm-canary-work)`,
			].join("\n");
			coordinator.updateStage(taskId, "awaiting confirmation");
			const confirmed = await ctx.ui.confirm("Create Kernel-managed task?", summary, {
				timeout: 10 * 60 * 1000,
				signal: ctx.signal,
			});
			if (!confirmed) {
				ctx.ui.notify("Task creation cancelled", "info");
				return;
			}
			ctx.signal?.throwIfAborted();
			coordinator.updateStage(taskId, "revalidating");

			// 6. Post-confirm revalidation: every owner must be unchanged since
			//    the preview. Any drift aborts before any write.
			const { unchanged } = await revalidatePiCanary(ctx.cwd, { task_id: taskId, now }, preparation);
			if (!unchanged) {
				ctx.ui.notify("new-task creation aborted: workspace changed after confirmation", "error");
				return;
			}
			ctx.signal?.throwIfAborted();
			assertDescriptorRehearsalSnapshot(ctx.cwd, descriptorRehearsal);

			// 7. One-shot capability bound to the exact confirmation and rehearsal receipt.
			const binding = {
				task_id: taskId,
				intent_path: preparation.intent?.path ?? `docs/plans/${taskId}.intent.json`,
				intent_revision: preparation.intent?.revision ?? 1,
				intent_content_hash: preparation.intent?.content_hash ?? "",
				preparation_digest: preparation.digest,
				// Compatibility mirror fields (never authority after v4).
				readiness_digest: rehearsalReceiptRef,
				evidence_digest: rehearsalReceiptRef,
				waiver_gate: "observation_window_days",
				actor_id: "user",
				confirmation_ref: `pi-confirm-${createHash("sha256").update(`${taskId}\0${now}`).digest("hex").slice(0, 16)}`,
				expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
				nonce: createHash("sha256").update(`${taskId}\0${now}\0pi`).digest("hex"),
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

			// 8. Kernel-owner rehearsal (zero-write) before final enrollment.
			coordinator.updateStage(taskId, "kernel rehearsal");
			const rehearsal = await runEnrollmentRehearsal(ctx.cwd, input, capability, registry);
			if (!rehearsal.rehearsed || rehearsal.evidence.outcome !== "ready") {
				ctx.ui.notify(
					`new-task rehearsal failed: ${rehearsal.evidence.blockers.join("; ")}`,
					"error",
				);
				return;
			}

			ctx.signal?.throwIfAborted();
			assertDescriptorRehearsalSnapshot(ctx.cwd, descriptorRehearsal);

			// 9. Atomic enrollment (final-lock revalidation inside enrollCanaryTask).
			//    Cancellation after this point is rejected; authority settlement proceeds.
			if (!coordinator.markCommitting(taskId, ctx)) return;
			try {
				const result = await enrollCanaryTask(ctx.cwd, input, registry);
				ctx.ui.notify(
					`task created on the Kernel route: ${result.record.task_id} phase=${result.record.phase} backend=${result.backend_claim.backend} rehearsal=passed receipt=${rehearsalReceiptRef} - continue with the imm-canary-work Skill`,
					"info",
				);
			} catch (error) {
				ctx.ui.notify(
					`task creation failed: ${error instanceof Error ? error.message : String(error)}`,
					"error",
				);
			}
	};
	pi.registerCommand("imm-canary-new", {
		description:
			"Create a new Kernel-managed task on this host (default route; readiness must be candidate, no waiver)",
		handler,
	});
	if (typeof pi.on === "function")
		pi.on("session_shutdown", async () => coordinator.shutdown());
}
