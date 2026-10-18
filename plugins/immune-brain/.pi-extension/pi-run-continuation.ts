import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { realpathSync } from "node:fs";
import { projectTaskStatus } from "../runtime/assurance/coordinator";
import { readTaskRecordRaw } from "../runtime/kernel/storage";
import type { PhaseEntry } from "../runtime/assurance/phase_entry";
import { recordParentRepair } from "../runtime/unattended/batch_git";
import { readAnyBatchRunState } from "../runtime/unattended/batch_state";
import { bindRun, decideRunContinuation, observeParentRun, parkFailedCriticalGate, releasesRunBinding, scopedSourceDigest,
	type RunContinuationState, type ReviewContinuationState } from "../runtime/assurance/run_continuation";

type SettleBoundary = {
	outcome: "completed" | "aborted" | "error";
	continue: boolean;
	context: { canContinue: boolean; pendingMessages: unknown[] };
};
/** Spec D9: the third native-operation failure under one entry pauses; the first two leave the run live for a retry. */
const NATIVE_FAILURE_LIMIT = 3;
type ContinuationBoundaryResult = { continue?: boolean; entries?: Array<{ type: "custom_message"; customType: string; display: boolean; content: string }> } | void;

/** Continuation is session memory, never a capability or durable task owner. */
export function registerPiRunContinuation(pi: ExtensionAPI, ports: {
	entry(text: string, root: string): PhaseEntry | null;
	/** ADR 0025: ends the session's entry token at a pause or when the bound run is terminal. */
	revokeEntry?(sessionId: string): void;
}): { selectedParent(root: string, sessionId: string, slug: string): boolean } {
	let entered = false;
	let state: RunContinuationState | undefined;
	let hostFailure: string | undefined;
	const failedGates = new Set<string>();
	let nativeFailures = 0;
	/** Counts one failure; only the last one in the budget blocks the gate and pauses at the next boundary. */
	const failNative = (gate: string, reason: string): boolean => {
		if (++nativeFailures < NATIVE_FAILURE_LIMIT) return false;
		failedGates.add(gate); hostFailure = reason; return true;
	};
	let reviewRecovery: string | undefined;
	let review: ReviewContinuationState = "unobserved";
	let reviewerPrompt: string | undefined;
	let reviewerCallId: string | undefined;
	const calls = new Map<string, { name: string; task_id?: string; op?: string; initiative_slug?: string }>();
	const reset = () => { entered = false; state = undefined; hostFailure = undefined; reviewRecovery = undefined;
		review = "unobserved"; reviewerPrompt = undefined; reviewerCallId = undefined; calls.clear(); };
	pi.on("session_start", () => { failedGates.clear(); nativeFailures = 0; reset(); });
	pi.on("session_shutdown", () => { failedGates.clear(); nativeFailures = 0; reset(); });
	pi.on("input", (event, ctx) => {
		if (event.source === "extension") return;
		const entry = ports.entry(event.text, ctx.cwd);
		if (releasesRunBinding(event.text, entry === "plan" ? "planner" : entry)) { reset(); return; }
		if (entry === "run") { failedGates.clear(); nativeFailures = 0; reset(); entered = true; }
	});
	pi.on("tool_call", (event) => {
		const gateInput = event.input as { task_id?: unknown; initiative_slug?: unknown; action?: { op?: unknown } };
		const gate = `${event.toolName}:${gateInput.task_id ?? gateInput.initiative_slug ?? ""}:${gateInput.action?.op ?? ""}`;
		if (failedGates.has(gate)) return { block: true, reason: `This native gate failed ${NATIVE_FAILURE_LIMIT} times under this entry; enter imm-run explicitly before retrying` };
		if (!entered) return;
		if (event.toolName === "imm_canary_enrollment" && state?.binding.kind === "parent" &&
			state.binding.blocked_native_tasks?.includes(String(event.input.task_id)))
			return { block: true, reason: "This critical gate is parked; continue independent work or resolve its same-Host recovery and enter imm-run explicitly" };
		if (event.toolName === "Agent" && reviewerPrompt &&
			(event.input.subagent_type === "Review" || event.input.prompt === reviewerPrompt)) {
			if (event.input.prompt !== reviewerPrompt || event.input.subagent_type !== "Review" || event.input.run_in_background !== false)
				return { block: true, reason: "Kernel Review requires the complete exact agent_params from advance_assurance: preserve prompt bytes, subagent_type Review, and run_in_background false. No reviewer was dispatched." };
			if (reviewerCallId) { review = "rejected"; return { block: true, reason: "Reserved Reviewer already dispatched; wait for its result and submit the verdict before any new dispatch" }; }
			reviewerCallId = event.toolCallId; review = "running"; return;
		}
		if (!["imm_canary_enrollment", "imm_kernel_canary", "start_unattended_batch", "retire_stale_batch"].includes(event.toolName)) return;
		const input = event.input as { task_id?: unknown; initiative_slug?: unknown; action?: { op?: unknown } };
		calls.set(event.toolCallId, { name: event.toolName,
			task_id: typeof input.task_id === "string" ? input.task_id : undefined,
			initiative_slug: typeof input.initiative_slug === "string" ? input.initiative_slug : undefined,
			op: typeof input.action?.op === "string" ? input.action.op : undefined });
	});
	pi.on("tool_result", async (event, ctx) => {
		if (entered && event.toolName === "Agent" && event.toolCallId === reviewerCallId) review = "returned";
		const call = calls.get(event.toolCallId); calls.delete(event.toolCallId);
		if (!entered || !call) return;
		if (call.name === "retire_stale_batch") {
			if (event.isError || (event.details as { state?: string } | undefined)?.state !== "retired")
				failNative(`${call.name}:${call.initiative_slug ?? ""}:`, "Batch retirement did not apply; inspect the same-Host recovery");
			return;
		}
		if (call.name === "start_unattended_batch") {
			const result = event.details as { state?: string; batch_id?: string | null; plan_digest?: string; final_verification_commands?: string[] } | undefined;
			if (!event.isError && result?.state === "native_parent" && typeof result.plan_digest === "string" && call.initiative_slug) {
				if (!state || state.binding.kind !== "parent") state = bindRun({ kind: "parent", workspace: realpathSync(ctx.cwd),
					session_id: ctx.sessionManager.getSessionId(), initiative_slug: call.initiative_slug, batch_id: null,
					plan_digest: result.plan_digest, final_verification: result.final_verification_commands });
				return;
			}
			if (event.isError || result?.state !== "started" || !result.batch_id || !call.initiative_slug) {
				failNative(`${call.name}:${call.initiative_slug ?? ""}:`, "Batch native operation did not apply; inspect the same-Host recovery"); return;
			}
			const record = readAnyBatchRunState(ctx.cwd, result.batch_id);
			if (!record || record.initiative_slug !== call.initiative_slug) { hostFailure = "Batch result has no matching persisted identity"; return; }
			if (!state || state.binding.kind !== "parent") state = bindRun({ kind: "parent", workspace: realpathSync(ctx.cwd),
				session_id: ctx.sessionManager.getSessionId(), initiative_slug: record.initiative_slug, batch_id: record.batch_id, plan_digest: record.plan_digest });
			return;
		}
		if (!call.task_id) return;
		const details = event.details as { state?: unknown; reason?: unknown; recovery_action?: unknown; next_action?: unknown;
			agent_params?: { prompt?: unknown } } | undefined;
		if ((event.isError || ["blocked", "cancelled", "rejected", "failed"].includes(String(details?.state))) &&
			(call.name === "imm_canary_enrollment" || ["request_authorization", "approve_breaking_intent_revision", "request_stop"].includes(call.op ?? ""))) {
			if (failNative(`${call.name}:${call.task_id}:${call.op ?? ""}`,
				typeof details?.reason === "string" ? details.reason : "Native authority operation failed or was cancelled") &&
				call.name === "imm_canary_enrollment" && state && await parkFailedCriticalGate(state.binding, call.task_id)) hostFailure = undefined;
			return;
		}
		if (call.op === "advance_assurance" && !event.isError && details?.state === "review_ready") {
			if (typeof details.agent_params?.prompt === "string" && details.agent_params.prompt !== reviewerPrompt) {
				reviewerPrompt = details.agent_params.prompt; reviewerCallId = undefined; review = "ready";
			}
			reviewRecovery = undefined;
		}
		if (call.op === "submit_review") {
			if (event.isError) {
				review = "rejected";
				const action = details?.recovery_action ?? details?.next_action;
				reviewRecovery = typeof action === "string" ? action : undefined;
			} else {
				review = "unobserved"; reviewerPrompt = undefined; reviewerCallId = undefined; reviewRecovery = undefined;
			}
		}
		if (call.name === "imm_canary_enrollment" && !event.isError && details?.state === "completed" && state?.binding.kind === "parent")
			await recordParentRepair(ctx.cwd, state.binding.batch_id, call.task_id, state.binding.initiative_slug);
		if (state || event.isError) return;
		const status = await projectTaskStatus(ctx.cwd, call.task_id);
		if (status.error || status.claim?.task_id !== call.task_id || status.projection.lifecycle !== "active" || !status.projection.run_id) return;
		state = bindRun({ kind: "task", workspace: realpathSync(ctx.cwd), session_id: ctx.sessionManager.getSessionId(),
			task_id: call.task_id, run_id: status.projection.run_id });
	});
	// shortcut: optional workspace SDK types predate Pi 1.2; remove this declaration when that peer reaches 1.2 (owner: Immune-Brain).
	const boundaryApi = pi as ExtensionAPI & { on(event: "agent_before_settle", handler: (event: SettleBoundary, ctx: ExtensionContext) => Promise<ContinuationBoundaryResult>): void };
	boundaryApi.on("agent_before_settle", async (event, ctx) => {
		if (!entered) return;
		const revoke = () => ports.revokeEntry?.(ctx.sessionManager.getSessionId());
		// Spec D13: an interrupted or non-continuable turn ends the entry like a pause.
		if (event.outcome !== "completed" || !event.context.canContinue) { revoke(); reset(); return; }
		if (!state) return;
		if (event.continue || event.context.pendingMessages.length) return;
		try {
			if (state.binding.kind === "parent") {
				const decision = decideRunContinuation(state, { ...await observeParentRun(state.binding,
					ctx.sessionManager.getLeafId() ?? "empty-session", review, reviewRecovery), host_failure: hostFailure });
				state = decision.state;
				if (decision.action === "settled" || decision.action === "unbound") { if (decision.action === "settled") revoke(); reset(); return; }
				if (decision.action === "wait") return;
				if (decision.action === "pause") { revoke(); reset(); return { entries: [{ type: "custom_message", customType: "immune-brain-run-paused", display: true, content: `Parent paused: ${decision.reason}. ${decision.next_action ?? ""}` }] }; }
				return { continue: true, entries: [{ type: "custom_message", customType: "immune-brain-run-continuation", display: false,
					content: `Parent remains incomplete. ${decision.next_action}. Continue the authorized Loop and batch; individual Slice settlement does not complete the Parent.` }] };
			}
			const taskId = state.binding.task_id;
			const status = await projectTaskStatus(ctx.cwd, taskId);
			const record = await readTaskRecordRaw(ctx.cwd, taskId);
			if (!record.record && status.projection.lifecycle === "active") throw new Error("bound run has no live TaskRecord");
			const decision = decideRunContinuation(state, { kind: "task", workspace: realpathSync(ctx.cwd),
				session_id: ctx.sessionManager.getSessionId(), boundary_id: ctx.sessionManager.getLeafId() ?? "empty-session",
				status, source_digest: record.record ? scopedSourceDigest(ctx.cwd, record.record.intent_snapshot.scope_hint) : "terminal",
				review, recovery_action: reviewRecovery, host_failure: hostFailure });
			state = decision.state;
			// A terminal bound run spends its entry token; the next run needs a new literal entry.
			if (decision.action === "settled" || decision.action === "unbound") { if (decision.action === "settled") revoke(); reset(); return; }
			if (decision.action === "wait") return;
			if (decision.action === "pause") {
				revoke();
				reset();
				return { entries: [{ type: "custom_message" as const, customType: "immune-brain-run-paused", display: true,
					content: `Run paused: ${decision.reason}${decision.next_action ? `. Recovery: ${decision.next_action}` : ""}` }] };
			}
			return { continue: true, entries: [{ type: "custom_message" as const, customType: "immune-brain-run-continuation", display: false,
				content: `Explicit imm-run remains bound to task ${taskId}, run ${state.binding.kind === "task" ? state.binding.run_id : ""}. Kernel settlement is incomplete. ${decision.next_action}. Continue the authorized Loop; report completion only after authoritative settlement.` }] };
		} catch (error) {
			revoke();
			reset();
			return { entries: [{ type: "custom_message" as const, customType: "immune-brain-run-paused", display: true,
				content: `Run paused because continuation facts could not be verified: ${error instanceof Error ? error.message : String(error)}` }] };
		}
	});
	return { selectedParent: (root, sessionId, slug) => entered && state?.binding.kind === "parent" &&
		state.binding.workspace === realpathSync(root) && state.binding.session_id === sessionId && state.binding.initiative_slug === slug };
}
