// Pi run continuation: typed-event mapping over the shared state
// machine (Spec docs/specs/tri-host-capability-alignment.spec.md D6).
//
// Interface: `PI_CACHE_DIR`, `piContinuationHost`, `readRunToolSession`,
// `selectedPiParent`, `registerPiRunContinuation`.
// Invariants: every continuation decision re-reads the Kernel; the entry token
// ends with its session, a pause or a settlement; 7 consecutive settle boundaries pause
// with Pi-named recovery; tool correlation is one-use and workspace-scoped.
// Side Effects: reads and writes private session/correlation files under PI_CACHE_DIR.
// Verification: `bun test tests/pi-run-continuation.test.ts`.

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import type { PhaseEntry } from "../runtime/assurance/phase_entry";
import { digestOfReviewerBytes } from "../runtime/assurance/review_mediation";
import { releasesRunBinding } from "../runtime/assurance/run_continuation";
import {
	applyRunContinuationEvent,
	readSessionMetadata,
	readSessionToolCall,
	selectedParentSession,
	type RunContinuationHost,
} from "../runtime/host-core/run_continuation_session";

type SettleBoundary = {
	outcome: "completed" | "aborted" | "error";
	continue: boolean;
	context: { canContinue: boolean; pendingMessages: unknown[] };
};

type ContinuationBoundaryResult = {
	continue?: boolean;
	entries?: Array<{ type: "custom_message"; customType: string; display: boolean; content: string }>;
} | void;

export const PI_CACHE_DIR = "immune-brain-pi";

const GLOBAL_PI_PHASE_ENTRY_KEY = Symbol.for("immune_brain.pi_phase_entry");

export function getPiPhaseEntries(): Map<string, { run_live?: boolean; token?: string | null; workspace?: string | null }> {
	const holder = globalThis as unknown as Record<
		symbol,
		Map<string, { run_live?: boolean; token?: string | null; workspace?: string | null }> | undefined
	>;
	return (holder[GLOBAL_PI_PHASE_ENTRY_KEY] ??= new Map());
}

export function piContinuationHost(
	root: string,
	ports?: {
		entry_state?(sessionId: string): { run_live?: boolean } | null;
		revoke_entry?(sessionId: string): void;
		drop_entry_log?(sessionId: string): void;
	},
): RunContinuationHost {
	return {
		cache_name: PI_CACHE_DIR,
		host_name: "Pi",
		entry_state: (sessionId) => {
			if (ports?.entry_state) return ports.entry_state(sessionId);
			const state = getPiPhaseEntries().get(sessionId);
			return state ?? null;
		},
		revoke_entry: (sessionId) => {
			if (ports?.revoke_entry) ports.revoke_entry(sessionId);
			getPiPhaseEntries().delete(sessionId);
		},
		drop_entry_log: (sessionId) => {
			if (ports?.drop_entry_log) ports.drop_entry_log(sessionId);
			getPiPhaseEntries().delete(sessionId);
		},
	};
}

/** Exact PreToolUse correlation; the transport connection ID is never a session. */
export function readRunToolSession(
	toolId: string,
	operation: string,
	workspace: string,
	root = tmpdir(),
): string | null {
	return readSessionToolCall(piContinuationHost(root), root, toolId, operation, workspace);
}

export function selectedPiParent(
	toolId: string,
	workspace: string,
	slug: string,
	root = tmpdir(),
): boolean {
	return selectedParentSession(piContinuationHost(root), root, toolId, workspace, slug);
}

/** Continuation is session memory, never a capability or durable task owner. */
export function registerPiRunContinuation(
	pi: ExtensionAPI,
	ports: {
		entry(text: string, root: string): PhaseEntry | null;
		/** ADR 0025: ends the session's entry token at a pause or when the bound run is terminal. */
		revokeEntry?(sessionId: string): void;
		entryState?(sessionId: string): { run_live?: boolean } | null;
	},
	options?: {
		storeRoot?: string;
	},
): { selectedParent(toolId: string, workspace: string, slug: string): boolean } {
	const storeRoot = options?.storeRoot ?? tmpdir();
	const host = piContinuationHost(storeRoot, {
		entry_state: ports.entryState ?? ((id) => getPiPhaseEntries().get(id) ?? null),
		revoke_entry: (id) => {
			getPiPhaseEntries().delete(id);
			ports.revokeEntry?.(id);
		},
		drop_entry_log: (id) => {
			getPiPhaseEntries().delete(id);
		},
	});

	let activeContext: ExtensionContext | undefined;
	const pendingCalls = new Map<string, { operation: string; taskId: string | null }>();
	const pausedNotified = new Set<string>();
	const userTurns = new Set<string>();

	pi.on("session_start", async (_event, ctx) => {
		activeContext = ctx;
		const sessionId = ctx?.sessionManager?.getSessionId?.() ?? "";
		if (sessionId) {
			pausedNotified.delete(sessionId);
			host.revoke_entry(sessionId);
			const workspace = ctx?.cwd ? realpathSync(ctx.cwd) : process.cwd();
			await applyRunContinuationEvent(host, storeRoot, { session_id: sessionId, workspace }, { kind: "session_end" });
		}
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		activeContext = ctx;
		const sessionId = ctx?.sessionManager?.getSessionId?.() ?? activeContext?.sessionManager?.getSessionId?.() ?? "";
		if (sessionId) {
			pausedNotified.delete(sessionId);
			host.revoke_entry(sessionId);
			const workspace = ctx?.cwd ? realpathSync(ctx.cwd) : (activeContext?.cwd ? realpathSync(activeContext.cwd) : process.cwd());
			await applyRunContinuationEvent(host, storeRoot, { session_id: sessionId, workspace }, { kind: "session_end" });
		}
	});

	pi.on("input", async (event, ctx) => {
		if (event.source === "extension") return;
		activeContext = ctx;
		const sessionId = ctx.sessionManager?.getSessionId?.() ?? "";
		userTurns.add(sessionId);
		pausedNotified.delete(sessionId);
		const entry = ports.entry(event.text, ctx.cwd);
		const releases = releasesRunBinding(event.text, entry === "plan" ? "planner" : entry);
		if (releases) {
			host.revoke_entry(sessionId);
		} else if (entry === "run") {
			const existing = getPiPhaseEntries().get(sessionId);
			if (!existing || !existing.run_live || !existing.token) {
				getPiPhaseEntries().set(sessionId, {
					run_live: true,
					token: existing?.token ?? null,
					workspace: existing?.workspace ?? realpathSync(ctx.cwd),
				});
			}
		}
		const workspace = realpathSync(ctx.cwd);
		await applyRunContinuationEvent(host, storeRoot, { session_id: sessionId, workspace }, {
			kind: "prompt",
			releases: releases || entry === "run",
		});
	});

	pi.on("tool_call", async (event, ctx) => {
		activeContext = ctx ?? activeContext;
		const sessionId = activeContext?.sessionManager?.getSessionId?.() ?? "";
		const workspace = activeContext?.cwd ? realpathSync(activeContext.cwd) : process.cwd();
		const session = { session_id: sessionId, workspace };

		if (event.toolName === "Agent") {
			const metadata = readSessionMetadata(host, storeRoot, sessionId);
			if (metadata.state && metadata.reviewer_prompt) {
				const input = (event.input ?? {}) as { prompt?: unknown; subagent_type?: unknown; run_in_background?: unknown };
				const inputPrompt = typeof input.prompt === "string" ? input.prompt : "";
				const promptDigest = digestOfReviewerBytes(inputPrompt);
				const isReviewAttempt = input.subagent_type === "Review" || promptDigest === metadata.reviewer_prompt;
				if (!isReviewAttempt) return;
				if (promptDigest !== metadata.reviewer_prompt || input.subagent_type !== "Review" || input.run_in_background !== false) {
					return {
						block: true,
						reason: "Kernel Review requires the complete exact agent_params from advance_assurance: preserve prompt bytes, subagent_type Review, and run_in_background false. No reviewer was dispatched.",
					};
				}
				if (metadata.reviewer_call_id) {
					await applyRunContinuationEvent(host, storeRoot, session, {
						kind: "reviewer",
						phase: "dispatch",
						call_id: event.toolCallId,
						prompt_digest: promptDigest,
						agent_id: null,
						asynchronous: false,
					});
					return {
						block: true,
						reason: "Reserved Reviewer already dispatched; wait for its result and submit the verdict before any new dispatch",
					};
				}
				await applyRunContinuationEvent(host, storeRoot, session, {
					kind: "reviewer",
					phase: "dispatch",
					call_id: event.toolCallId,
					prompt_digest: promptDigest,
					agent_id: null,
					asynchronous: false,
				});
				return;
			}
			return;
		}

		if (!["imm_kernel_canary", "start_unattended_batch", "retire_stale_batch"].includes(event.toolName)) return;

		const input = (event.input ?? {}) as { task_id?: unknown; initiative_slug?: unknown; action?: { op?: unknown } };
		const operation = event.toolName === "imm_kernel_canary"
			? (typeof input.action?.op === "string" ? input.action.op : "")
			: event.toolName;
		const taskId = typeof input.task_id === "string" ? input.task_id : (typeof input.initiative_slug === "string" ? input.initiative_slug : null);

		pendingCalls.set(event.toolCallId, { operation, taskId });

		const outcome = await applyRunContinuationEvent(host, storeRoot, session, {
			kind: "tool_call",
			operation,
			tool_id: event.toolCallId,
			task_id: taskId,
		});

		if (outcome.kind === "deny") {
			return {
				block: true,
				reason: `Run paused: ${outcome.reason}; enter drive explicitly before another native gate`,
			};
		}
	});

	pi.on("tool_result", async (event, ctx) => {
		activeContext = ctx ?? activeContext;
		const sessionId = activeContext?.sessionManager?.getSessionId?.() ?? "";
		const workspace = activeContext?.cwd ? realpathSync(activeContext.cwd) : process.cwd();
		const session = { session_id: sessionId, workspace };

		if (event.toolName === "Agent") {
			await applyRunContinuationEvent(host, storeRoot, session, {
				kind: "reviewer",
				phase: "return",
				call_id: event.toolCallId,
				prompt_digest: null,
				agent_id: null,
				asynchronous: false,
			});
			return;
		}

		const call = pendingCalls.get(event.toolCallId);
		pendingCalls.delete(event.toolCallId);
		if (!call) return;

		const details = (event.details ?? (event as any).result ?? {}) as Record<string, unknown>;
		const response = call.taskId && !details.initiative_slug
			? { ...details, initiative_slug: call.taskId }
			: details;

		await applyRunContinuationEvent(host, storeRoot, session, {
			kind: "tool_result",
			operation: call.operation,
			tool_id: event.toolCallId,
			response,
			failed: Boolean(event.isError),
		});
	});

	const boundaryApi = pi as ExtensionAPI & {
		on(
			event: "agent_before_settle",
			handler: (event: SettleBoundary, ctx: ExtensionContext) => Promise<ContinuationBoundaryResult>,
		): void;
	};

	boundaryApi.on("agent_before_settle", async (event, ctx) => {
		activeContext = ctx ?? activeContext;
		const sessionId = ctx.sessionManager?.getSessionId?.() ?? activeContext?.sessionManager?.getSessionId?.() ?? "";
		const workspace = realpathSync(ctx.cwd);
		const session = { session_id: sessionId, workspace };

		// Spec D13: an interrupted or non-continuable turn ends the entry like a pause.
		if (event.outcome !== "completed" || !event.context.canContinue) {
			host.revoke_entry(sessionId);
			await applyRunContinuationEvent(host, storeRoot, session, { kind: "session_end" });
			return;
		}

		if (event.continue || event.context.pendingMessages.length) return;

		try {
			const isUserTurn = userTurns.has(sessionId);
			userTurns.delete(sessionId);
			const stop_hook_active = !isUserTurn;

			const outcome = await applyRunContinuationEvent(host, storeRoot, session, {
				kind: "stop",
				boundary: () => ctx.sessionManager.getLeafId() ?? "empty-session",
				stop_hook_active,
			});

			if (outcome.kind === "continue") {
				const metadata = readSessionMetadata(host, storeRoot, sessionId);
				const content = metadata.state?.binding.kind === "parent"
					? `Parent remains incomplete. ${outcome.next_action}. Continue the authorized Loop and batch; individual Slice settlement does not complete the Parent.`
					: `Explicit drive remains bound to task ${outcome.label}. Kernel settlement is incomplete. ${outcome.next_action}. Continue the authorized Loop; report completion only after authoritative settlement.`;
				return {
					continue: true,
					entries: [{
						type: "custom_message",
						customType: "immune-brain-run-continuation",
						display: false,
						content,
					}],
				};
			}

			if (outcome.kind === "paused") {
				if (pausedNotified.has(sessionId)) return;
				pausedNotified.add(sessionId);
				return {
					entries: [{
						type: "custom_message",
						customType: "immune-brain-run-paused",
						display: true,
						content: `Run paused: ${outcome.reason}`,
					}],
				};
			}

			return;
		} catch (error) {
			host.revoke_entry(sessionId);
			return {
				entries: [{
					type: "custom_message",
					customType: "immune-brain-run-paused",
					display: true,
					content: `Run paused because continuation facts could not be verified: ${error instanceof Error ? error.message : String(error)}`,
				}],
			};
		}
	});

	return {
		selectedParent: (toolId: string, workspace: string, slug: string) => {
			return selectedPiParent(toolId, workspace, slug, storeRoot);
		},
	};
}
