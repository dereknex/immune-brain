// Lane sessions composition root (Spec unified-lane-sessions S5, D1/D10/D14/D20).
//
// The sole runtime module importing both `runtime/session/` and
// `runtime/unattended/`. It owns no Lane state transitions: `startLanes` and
// `advanceLanes` resolve the Executor provider once, bind a `SessionPortAdapter`
// and delegate to `advanceBatch`; `observeLanes` waits read-only for the D20
// wake set and reports `next_action`.
//
// Interface: `startLanes(agreement, deps)`, `advanceLanes(root, batchId, deps)`,
// `observeLanes(root, batchId, deps, options)`.
// Side Effects: `startLanes`/`advanceLanes` run `advanceBatch` (worktrees,
// enrollment, session reconciliation); `observeLanes` performs no writes.
// Verification: `bun test tests/lane-sessions.test.ts`.
import { resolveSessionProvider, SESSION_PROVIDER_REGISTRY, type SessionProviderDescriptor } from "../session/provider_registry";
import type { ExecutorHostKind, SupervisedSessionPort } from "../session/supervised_session_port";
import { laneExecutorChoice } from "../unattended/agent_profiles";
import type { ExecutorPreferences } from "../unattended/agent_profiles";
import { runLaneBatch as advanceBatch } from "../unattended/batch_lanes";
import type { BatchRunnerKernelPort, BatchTrackerPort } from "../unattended/batch_kernel_port";
import type { BatchRunnerGitPort } from "../unattended/batch_git";
import {
	isLaneBatchRecord,
	isTerminalBatchState,
	readAnyBatchRunState,
	type AnyBatchRunStateRecord,
	type BatchLaneRunStateRecord,
} from "../unattended/batch_state";
import type { BatchAgreement } from "../unattended/batch_agreement";
import type { BatchSessionPort } from "../unattended/batch_session_port";
import { SessionPortAdapter } from "./session_port_adapter";

export interface LaneSessionRefusal {
	ok: false;
	code: "lane_session_unavailable";
	reason: string;
	recovery: string;
	reasons?: Array<{ provider: string; reason: string; recovery: string }>;
}

export type LaneNextAction = "advance" | "relay_dialog" | "ask_user" | "wait" | "complete";

export interface LaneChildObservation {
	task_id: string;
	state: string | null;
	entry_submitted: boolean | null;
	settled: boolean | null;
}

export interface LaneBatchObservation {
	ok: true;
	batch_id: string;
	batch_state: string;
	children: LaneChildObservation[];
	next_action: LaneNextAction;
}

export interface LaneSessionsDeps {
	root: string;
	registry: unknown;
	capability: unknown;
	kernel: BatchRunnerKernelPort;
	git?: BatchRunnerGitPort;
	tracker?: BatchTrackerPort;
	providers: string[];
	host: ExecutorHostKind;
	env: Record<string, string | undefined>;
	providerRegistry?: readonly SessionProviderDescriptor[];
	createPort?: (provider: string, env: Record<string, string | undefined>) => SupervisedSessionPort;
	/** Entry kind the batch was authorized under; new records persist it so re-entry matches. Carried opaquely: this composition root never interprets it. */
	entry_kind?: "single_task";
	hostArgs?: string[] | ((taskId: string) => string[]);
	/** The requested Executor profile; sessions open with the effective choice, never the Parent Host by default. */
	executor?: ExecutorPreferences;
	max_parallel?: number;
	now?: string;
	confirmation_time?: string;
	/** A Host native gate just accepted this re-entry. Daemon advances omit it. */
	literal_user_confirmation?: boolean;
	executor_runtime?: string;
	lane_instruction?: unknown;
	lane_session_close?: unknown;
	lane_offers?: unknown;
	review_profile?: unknown;
	final_verification?: string[];
	topology_digest?: string;
}

export interface ObserveLanesDeps {
	kernel: BatchRunnerKernelPort;
	env: Record<string, string | undefined>;
	providerRegistry?: readonly SessionProviderDescriptor[];
	createPort?: (provider: string, env: Record<string, string | undefined>) => SupervisedSessionPort;
	host: ExecutorHostKind;
	hostArgs?: string[] | ((taskId: string) => string[]);
}

function hostArgsFor(deps: { hostArgs?: string[] | ((taskId: string) => string[]) }, taskId: string): string[] {
	if (!deps.hostArgs) return [];
	return typeof deps.hostArgs === "function" ? deps.hostArgs(taskId) : [...deps.hostArgs];
}

/**
 * Resume validates the fresh authorization against the record's identities
 * (rebinds included), so the resumptive input carries identity-bearing
 * children derived from the record instead of bare child shadows (which
 * carry no intent fields and would fail the digest check unconditionally).
 */
function resumeChildren(record: BatchLaneRunStateRecord): Array<{ task_id: string; slice_id: string; blocked_by: string[]; status: "enrollable"; reason: null; intent_path: string | null; intent_revision: number | null; intent_content_hash: string | null; intent_authority_hash?: string }> {
	return record.children.map(child => {
		const identity = record.intent_identities?.[child.task_id];
		return { task_id: child.task_id, slice_id: child.slice_id, blocked_by: [...child.blocked_by], status: "enrollable" as const, reason: null,
			intent_path: identity?.intent_path ?? null, intent_revision: identity?.intent_revision ?? null,
			intent_content_hash: identity?.intent_content_hash ?? null,
			...(identity?.intent_authority_hash ? { intent_authority_hash: identity.intent_authority_hash } : {}) };
	});
}

/**
 * The interactive session's Host and argv from the batch's effective Executor
 * profile: the frozen/requested choice, else the configured `executor` role,
 * else the Parent Host on its defaults. The entry is submitted via prompt, so
 * no `--print` flag is included; model and effort use the same flags the
 * supervisor and Review sessions use (`--thinking` for pi effort).
 */
export function executorSessionTarget(input: { root: string; executor?: ExecutorPreferences; host: ExecutorHostKind }): {
	host: ExecutorHostKind;
	hostArgs: string[];
} {
	const choice = laneExecutorChoice(input.root, input.executor, input.host as never) ?? { host: input.host };
	const hostArgs: string[] = [];
	if (choice.model) hostArgs.push("--model", choice.model);
	if (choice.effort) hostArgs.push(choice.host === "pi" ? "--thinking" : "--effort", choice.effort);
	return { host: choice.host as ExecutorHostKind, hostArgs };
}

function portFor(
	provider: string,
	env: Record<string, string | undefined>,
	registry: readonly SessionProviderDescriptor[],
	createPort?: (provider: string, env: Record<string, string | undefined>) => SupervisedSessionPort,
): SupervisedSessionPort | null {
	if (createPort) {
		try {
			return createPort(provider, env);
		} catch {
			return null;
		}
	}
	const descriptor = registry.find((d) => d.name === provider);
	if (!descriptor) return null;
	return descriptor.factory(env);
}

/**
 * Open the batch's recorded session provider for a direct Port call: a
 * native-gated stop closes one child's session without a full advance.
 * Provider resolution stays in the composition root; callers pass only the
 * recorded provider name, never a session import. A test double arrives
 * through `createPort`; production passes none and resolves the real
 * provider, failing closed outside Herdr instead of inventing a session.
 */
export function openBatchSessionPort(input: {
	root: string;
	provider: string | null | undefined;
	env: Record<string, string | undefined>;
	host: ExecutorHostKind;
	executor?: ExecutorPreferences;
	hostArgs?: string[];
	providerRegistry?: readonly SessionProviderDescriptor[];
	createPort?: (provider: string, env: Record<string, string | undefined>) => SupervisedSessionPort;
}): { ok: true; port: BatchSessionPort } | { ok: false; reason: string; recovery: string } {
	const registry = input.providerRegistry ?? SESSION_PROVIDER_REGISTRY;
	if (!input.provider)
		return { ok: false, reason: "lane_session_unavailable: no session provider recorded for this batch", recovery: "retire the stale batch" };
	const descriptor = registry.find((d) => d.name === input.provider);
	if (!descriptor)
		return { ok: false, reason: `lane_session_unavailable: recorded provider ${input.provider} is not registered`, recovery: "retire the stale batch" };
	const check = descriptor.checkEnv(input.env);
	if (!check.ok)
		return { ok: false, reason: `lane_session_unavailable: ${check.reason}`, recovery: descriptor.recovery };
	const raw = portFor(input.provider, input.env, registry, input.createPort);
	if (!raw)
		return { ok: false, reason: "lane_session_unavailable: provider factory failed", recovery: "retry inside Herdr" };
	const target = executorSessionTarget({ root: input.root, executor: input.executor, host: input.host });
	return { ok: true, port: new SessionPortAdapter(raw, target.host, input.hostArgs ?? target.hostArgs) };
}

function refusalFromReasons(reasons: Array<{ provider: string; reason: string; recovery: string }>): LaneSessionRefusal {
	const detail = reasons.map((r) => `${r.provider}: ${r.reason}`).join("; ");
	return {
		ok: false,
		code: "lane_session_unavailable",
		reason: `lane_session_unavailable: ${detail}`,
		recovery: reasons[0]?.recovery ?? "run inside Herdr with HERDR_ENV=1 and HERDR_WORKSPACE_ID set",
		reasons,
	};
}

function toBatchInput(
	agreement: BatchAgreement,
	deps: LaneSessionsDeps,
	now: string,
	sessions: BatchSessionPort,
): Record<string, unknown> {
	return {
		root: deps.root,
		batch_id: agreement.batch_id,
		initiative_slug: agreement.initiative_slug,
		...(deps.entry_kind ? { entry_kind: deps.entry_kind } : {}),
		registry: deps.registry,
		capability: deps.capability,
		children: agreement.children,
		plan_digest: agreement.plan_digest,
		base_head: agreement.base_head,
		confirmation_time: deps.confirmation_time ?? now,
		budget: agreement.budget,
		now,
		kernel: deps.kernel,
		...(deps.git ? { git: deps.git } : {}),
		...(deps.tracker ? { tracker: deps.tracker } : {}),
		...(deps.max_parallel !== undefined ? { max_parallel: deps.max_parallel } : { max_parallel: agreement.children.length }),
		...(agreement.branch ? { branch: agreement.branch } : {}),
		confirmation: agreement.confirmation,
		return_policy: agreement.return_policy,
		interaction_mode: agreement.interaction_mode,
		...(agreement.final_verification.commands.length > 0 ? { final_verification: [...agreement.final_verification.commands] } : {}),
		final_verification_required: agreement.final_verification.required,
		// Freeze the requested Executor profile with the Parent Host, so resume
		// and later generations open sessions on the same host and argv the
		// batch started with instead of falling back per call.
		executor_freeze: { ...(deps.executor ? { request: deps.executor } : {}), parentHost: deps.host },
		...(deps.executor_runtime ? { executor_runtime: deps.executor_runtime } : {}),
		...(deps.max_parallel !== undefined ? { max_parallel: deps.max_parallel } : {}),
		...(deps.lane_instruction !== undefined ? { lane_instruction: deps.lane_instruction } : {}),
		...(deps.lane_session_close !== undefined ? { lane_session_close: deps.lane_session_close } : {}),
		...(deps.lane_offers !== undefined ? { lane_offers: deps.lane_offers } : {}),
		...(deps.review_profile !== undefined ? { review_profile: deps.review_profile } : {}),
		...(deps.final_verification !== undefined ? { final_verification: deps.final_verification } : {}),
		...(deps.topology_digest !== undefined ? { topology_digest: deps.topology_digest } : {}),
		sessions,
	};
}

export async function startLanes(
	agreement: BatchAgreement,
	deps: LaneSessionsDeps,
): Promise<Record<string, unknown> | LaneSessionRefusal> {
	const registry = deps.providerRegistry ?? SESSION_PROVIDER_REGISTRY;
	const target = executorSessionTarget({ root: deps.root, executor: deps.executor, host: deps.host });
	const resolved = resolveSessionProvider({ role: "executor", providers: deps.providers, host: target.host, env: deps.env, registry });
	if (!resolved.ok) return refusalFromReasons(resolved.reasons);
	const raw = portFor(resolved.provider, deps.env, registry, deps.createPort);
	if (!raw) return refusalFromReasons([{ provider: resolved.provider, reason: "provider factory failed", recovery: "retry inside Herdr" }]);
	const adapter = new SessionPortAdapter(raw, target.host, (deps.hostArgs?.length ? hostArgsFor(deps, agreement.children[0]?.task_id ?? "lane") : target.hostArgs));
	const now = deps.now ?? new Date().toISOString();
	const input = toBatchInput(agreement, deps, now, adapter);
	const rawReport = await advanceBatch(input as never, null);
	const report = rawReport as unknown as { handoffs?: Array<{ role?: string }> };
	if (Array.isArray(report.handoffs)) report.handoffs = report.handoffs.filter((h) => h.role !== "executor");
	return report as unknown as Record<string, unknown>;
}

export async function advanceLanes(
	root: string,
	batchId: string,
	deps: LaneSessionsDeps,
): Promise<Record<string, unknown> | LaneSessionRefusal> {
	let persisted: AnyBatchRunStateRecord | null = null;
	try {
		persisted = readAnyBatchRunState(root, batchId);
	} catch {
		return { ok: false, code: "lane_session_unavailable", reason: `lane_session_unavailable: unreadable batch ${batchId}`, recovery: "inspect the batch record" };
	}
	if (!persisted || !isLaneBatchRecord(persisted)) {
		return { ok: false, code: "lane_session_unavailable", reason: `lane_session_unavailable: no active v3 batch ${batchId}`, recovery: "start a fresh batch" };
	}
	const recordedProvider = (persisted as { session_provider?: string | null }).session_provider ?? null;
	const registry = deps.providerRegistry ?? SESSION_PROVIDER_REGISTRY;
	if (recordedProvider) {
		const descriptor = registry.find((d) => d.name === recordedProvider);
		if (!descriptor) {
			return refusalFromReasons([{ provider: recordedProvider, reason: "recorded provider is not registered", recovery: "retire the stale batch" }]);
		}
		const check = descriptor.checkEnv(deps.env);
		if (!check.ok) {
			return refusalFromReasons([{ provider: recordedProvider, reason: check.reason, recovery: descriptor.recovery }]);
		}
		const raw = portFor(recordedProvider, deps.env, registry, deps.createPort);
		if (!raw) return refusalFromReasons([{ provider: recordedProvider, reason: "provider factory failed", recovery: "retry inside Herdr" }]);
		// Resume honors the record's frozen Executor profile, falling back to the request.
		const resumeTarget = executorSessionTarget({ root: deps.root,
			executor: (persisted as { executor_preferences?: ExecutorPreferences }).executor_preferences ?? deps.executor, host: deps.host });
		const adapter = new SessionPortAdapter(raw, resumeTarget.host, (deps.hostArgs?.length ? hostArgsFor(deps, batchId) : resumeTarget.hostArgs));
		const now = deps.now ?? new Date().toISOString();
		const input = {
			root: deps.root,
			batch_id: batchId,
			initiative_slug: persisted.initiative_slug,
			...(deps.entry_kind ? { entry_kind: deps.entry_kind } : {}),
			registry: deps.registry,
			capability: deps.capability,
			children: resumeChildren(persisted),
			plan_digest: persisted.plan_digest,
			base_head: persisted.base_head,
			confirmation_time: deps.confirmation_time ?? now,
			budget: persisted.budget,
			now,
			kernel: deps.kernel,
			...(deps.git ? { git: deps.git } : {}),
			...(deps.tracker ? { tracker: deps.tracker } : {}),
			max_parallel: deps.max_parallel ?? persisted.max_parallel,
			...(deps.literal_user_confirmation ? { literal_user_confirmation: true } : {}),
			confirmation: (persisted as { confirmation?: unknown }).confirmation,
			return_policy: (persisted as { return_policy?: unknown }).return_policy,
			interaction_mode: (persisted as { interaction_mode?: unknown }).interaction_mode,
			...(Array.isArray((persisted as { final_verification?: unknown }).final_verification) ? { final_verification: (persisted as { final_verification: string[] }).final_verification } : {}),
			...(deps.lane_instruction !== undefined ? { lane_instruction: deps.lane_instruction } : {}),
			...(deps.lane_session_close !== undefined ? { lane_session_close: deps.lane_session_close } : {}),
			...(deps.lane_offers !== undefined ? { lane_offers: deps.lane_offers } : {}),
			...(deps.review_profile !== undefined ? { review_profile: deps.review_profile } : {}),
			sessions: adapter,
		};
		const rawAdv = await advanceBatch(input as never, persisted);
		const advReport = rawAdv as unknown as { handoffs?: Array<{ role?: string }> };
		if (Array.isArray(advReport.handoffs)) advReport.handoffs = advReport.handoffs.filter((h) => h.role !== "executor");
		return advReport as unknown as Record<string, unknown>;
	}
	const target = executorSessionTarget({ root: deps.root, executor: deps.executor, host: deps.host });
	const resolved = resolveSessionProvider({ role: "executor", providers: deps.providers, host: target.host, env: deps.env, registry });
	if (!resolved.ok) return refusalFromReasons(resolved.reasons);
	const raw = portFor(resolved.provider, deps.env, registry, deps.createPort);
	if (!raw) return refusalFromReasons([{ provider: resolved.provider, reason: "provider factory failed", recovery: "retry inside Herdr" }]);
	const adapter = new SessionPortAdapter(raw, target.host, (deps.hostArgs?.length ? hostArgsFor(deps, batchId) : target.hostArgs));
	const now = deps.now ?? new Date().toISOString();
	const input = {
		root: deps.root,
		batch_id: batchId,
		initiative_slug: persisted.initiative_slug,
		...(deps.entry_kind ? { entry_kind: deps.entry_kind } : {}),
		registry: deps.registry,
		capability: deps.capability,
		children: resumeChildren(persisted),
		plan_digest: persisted.plan_digest,
		base_head: persisted.base_head,
		confirmation_time: deps.confirmation_time ?? now,
		budget: persisted.budget,
		now,
		kernel: deps.kernel,
		...(deps.git ? { git: deps.git } : {}),
		...(deps.tracker ? { tracker: deps.tracker } : {}),
		max_parallel: deps.max_parallel ?? persisted.max_parallel,
		...(deps.literal_user_confirmation ? { literal_user_confirmation: true } : {}),
		...(deps.lane_instruction !== undefined ? { lane_instruction: deps.lane_instruction } : {}),
		...(deps.lane_session_close !== undefined ? { lane_session_close: deps.lane_session_close } : {}),
		...(deps.lane_offers !== undefined ? { lane_offers: deps.lane_offers } : {}),
		...(deps.review_profile !== undefined ? { review_profile: deps.review_profile } : {}),
		sessions: adapter,
	};
	const raw2 = await advanceBatch(input as never, persisted);
	const report2 = raw2 as unknown as { handoffs?: Array<{ role?: string }> };
	if (Array.isArray(report2.handoffs)) report2.handoffs = report2.handoffs.filter((h) => h.role !== "executor");
	return report2 as unknown as Record<string, unknown>;
}

async function snapshotChildren(
	root: string,
	record: AnyBatchRunStateRecord,
	deps: ObserveLanesDeps,
): Promise<{ children: LaneChildObservation[]; next_action: LaneNextAction }> {
	if (!isLaneBatchRecord(record)) {
		return { children: [], next_action: "complete" };
	}
	const rec = record as {
		batch_state: string;
		interaction_mode?: string;
		children: Array<{ task_id: string; lane?: { path: string } | null; session?: { key: string | null; handle: string | null; entry_submitted: boolean; baseline: string | null } | null }>;
	};
	if (isTerminalBatchState(rec.batch_state as never)) {
		return {
			children: rec.children.map((c) => ({ task_id: c.task_id, state: null, entry_submitted: c.session?.entry_submitted ?? null, settled: null })),
			next_action: "complete",
		};
	}
	const registry = deps.providerRegistry ?? SESSION_PROVIDER_REGISTRY;
	// A record without a recorded provider predates provider tracking: observe
	// it portless (states stay unknown) and never fall back to `herdr`, so an
	// observer can neither open nor touch a real session.
	const recordedName = (record as { session_provider?: string | null }).session_provider ?? null;
	const raw = recordedName ? portFor(recordedName, deps.env, registry, deps.createPort) : null;
	const observations: LaneChildObservation[] = [];
	let sawBlocked = false;
	let sawUnsubmitted = false;
	let sawStalled = false;
	let sawProgress = false;
	let sawWorking = false;
	/** A child settled or waits on a decision: the integrator acts whatever a sibling does. */
	let sawOutcome = false;
	for (const child of rec.children) {
		const session = child.session ?? null;
		let state: string | null = null;
		if (session?.handle && raw) {
			try {
				const adapter = new SessionPortAdapter(raw, deps.host, hostArgsFor(deps, child.task_id));
				const observed = await adapter.observe(session.handle);
				state = observed.state;
			} catch {
				state = "unknown";
			}
		}
		let settled: boolean | null = null;
		let baseline: string | null = session?.baseline ?? null;
		let revision: string | null = null;
		if (child.lane?.path) {
			try {
				const projected = await deps.kernel.projectTask(child.lane.path, child.task_id);
				if ((projected as { error?: unknown }).error === null) {
					const projection = (projected as { projection: { lifecycle?: string; completion_ready?: boolean; record_revision?: string; open_user_decision_count?: number; replan_required_ids?: string[] } }).projection;
					revision = projection.record_revision ?? null;
					const isSettled = projection.lifecycle === "done" && projection.completion_ready === true;
					settled = isSettled;
					const hasDecision = (projection.open_user_decision_count ?? 0) > 0 || (projection.replan_required_ids?.length ?? 0) > 0;
					if (isSettled || hasDecision) { sawProgress = true; sawOutcome = true; }
				}
			} catch {
				settled = null;
			}
		}
		observations.push({ task_id: child.task_id, state, entry_submitted: session?.entry_submitted ?? null, settled });
		if (session && session.entry_submitted === false) sawUnsubmitted = true;
		if (state === "blocked") sawBlocked = true;
		if (state === "working") sawWorking = true;
		if (state === "idle" || state === "done" || state === "exited") sawProgress = true;
		const mode = (rec as { interaction_mode?: string }).interaction_mode ?? "interactive_host";
		if (mode === "interactive_host" && (state === "idle" || state === "done") && baseline !== null && revision !== null && baseline === revision && settled === false) {
			sawStalled = true;
		}
	}
	if (sawBlocked || sawUnsubmitted) return { children: observations, next_action: "relay_dialog" };
	// A stalled interactive child needs the user even while a sibling still works;
	// a sibling that exited, settled or waits on a decision advances instead.
	if (sawStalled && sawWorking && !sawOutcome) return { children: observations, next_action: "ask_user" };
	if (sawStalled && !sawProgress) return { children: observations, next_action: "ask_user" };
	if (sawStalled && sawProgress) {
		const onlyStall = observations.every((o) => o.state === "idle" || o.state === "done") && observations.every((o) => o.settled === false);
		if (onlyStall) return { children: observations, next_action: "ask_user" };
	}
	if (sawProgress) return { children: observations, next_action: "advance" };
	const anySettled = observations.some((o) => o.settled === true);
	if (anySettled) return { children: observations, next_action: "advance" };
	return { children: observations, next_action: "wait" };
}

export async function observeLanes(
	root: string,
	batchId: string,
	deps: ObserveLanesDeps,
	options: { wait?: boolean; timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<LaneBatchObservation | LaneSessionRefusal> {
	let persisted: AnyBatchRunStateRecord | null = null;
	try {
		persisted = readAnyBatchRunState(root, batchId);
	} catch {
		return { ok: false, code: "lane_session_unavailable", reason: `lane_session_unavailable: unreadable batch ${batchId}`, recovery: "inspect the batch record" };
	}
	if (!persisted) {
		return { ok: false, code: "lane_session_unavailable", reason: `lane_session_unavailable: unknown batch ${batchId}`, recovery: "start a fresh batch" };
	}
	if (!isLaneBatchRecord(persisted)) {
		return { ok: false, code: "lane_session_unavailable", reason: `lane_session_unavailable: batch ${batchId} is not a v3 Lane batch`, recovery: "retire the stale batch" };
	}
	const waiting = options.wait === true;
	const timeoutMs = options.timeoutMs ?? (waiting ? 600_000 : 0);
	const deadline = Date.now() + timeoutMs;
	const first = await snapshotChildren(root, persisted, deps);
	if (!waiting) return { ok: true, batch_id: batchId, batch_state: (persisted as { batch_state: string }).batch_state, children: first.children, next_action: first.next_action };
	if (first.next_action !== "wait") {
		return { ok: true, batch_id: batchId, batch_state: (persisted as { batch_state: string }).batch_state, children: first.children, next_action: first.next_action };
	}
	for (;;) {
		if (options.signal?.aborted) {
			return { ok: true, batch_id: batchId, batch_state: (persisted as { batch_state: string }).batch_state, children: first.children, next_action: "wait" };
		}
		if (Date.now() >= deadline) {
			return { ok: true, batch_id: batchId, batch_state: (persisted as { batch_state: string }).batch_state, children: first.children, next_action: "wait" };
		}
		await new Promise((resolve) => setTimeout(resolve, 50));
		let current: AnyBatchRunStateRecord | null = null;
		try {
			current = readAnyBatchRunState(root, batchId);
		} catch {
			return { ok: false, code: "lane_session_unavailable", reason: `lane_session_unavailable: unreadable batch ${batchId}`, recovery: "inspect the batch record" };
		}
		if (!current || !isLaneBatchRecord(current)) {
			return { ok: false, code: "lane_session_unavailable", reason: `lane_session_unavailable: batch ${batchId} is not a v3 Lane batch`, recovery: "retire the stale batch" };
		}
		const snap = await snapshotChildren(root, current, deps);
		if (snap.next_action !== "wait") {
			return { ok: true, batch_id: batchId, batch_state: (current as { batch_state: string }).batch_state, children: snap.children, next_action: snap.next_action };
		}
		if (Date.now() >= deadline) {
			return { ok: true, batch_id: batchId, batch_state: (current as { batch_state: string }).batch_state, children: snap.children, next_action: "wait" };
		}
	}
}
