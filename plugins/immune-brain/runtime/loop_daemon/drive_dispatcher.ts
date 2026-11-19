/**
 * Loop Daemon: Drive Dispatcher — the 4th Composition Root (S8)
 *
 * Implements D15 of docs/specs/unified-lane-sessions.spec.md (BR-SCN-7). ADR 0039
 * Decision 2 makes the daemon a headless Parent: it calls `authorizeBatch`
 * (`LOOP_DAEMON_ACTOR_ID`, `tracker_approval` or `policy_auto`, `return_policy`
 * `retain_branch`, `interaction_mode` `parent_relayed`) plus `startLanes` on
 * first entry, and `advanceLanes(root, batch_id)` on every subsequent tick. A
 * stalled generation rotates without waiting for Kernel settlement (the
 * reconciler owns that); a child reporting `entry_submitted: false` or an
 * attention dialog is surfaced as `hold_for_dialog` so the tick escalates via
 * `planEscalation` instead of hanging in an unattended TUI prompt.
 *
 * Completion and PR eligibility are read from the settled v3 Batch Record (the
 * integrated child commit on retained `refs/heads/imm/<task_id>`) plus the
 * `verification_evidence_digest` computed from the tracked
 * `.imm/audit/<task_id>/` pair at that commit (D13). No exit-recorder files.
 */

import { authorizeBatch, type BatchConfirmationSource } from "../unattended/batch_agreement";
import { auditEvidenceDigest } from "../unattended/batch_git";
import type { BatchRunnerGitPort } from "../unattended/batch_git";
import { createBatchKernelPort } from "../unattended/batch_kernel_port";
import type { BatchRunnerKernelPort } from "../unattended/batch_kernel_port";
import { observeSingleTask } from "../unattended/batch_plan";
import { createBatchAuthorityRegistry } from "../kernel/batch_authority";
import type { BatchPlanChild } from "../kernel/batch_authority";
import { findActiveLaneBatchForTask } from "../unattended/batch_preflight";
import { isLaneBatchRecord, readAnyBatchRunState } from "../unattended/batch_state";
import { resolveConfig } from "../config/layered_config";
import { advanceLanes, startLanes } from "../lane_sessions/index";
import type { ExecutorPreferences } from "../unattended/agent_profiles";
import { createEnrollmentAuthorityRegistry } from "../kernel/enrollment_authority";
import { projectAssurance } from "../kernel/assurance_projection";
import { LOOP_DAEMON_ACTOR_ID } from "../kernel/actor_identity";
import type { BatchAuthorityRegistry } from "../kernel/batch_authority";

/** The daemon's composition-root name, as ADR 0039 Decision 2 records it. */
export const LOOP_DAEMON_COMPOSITION_ROOT = "loop_daemon";

/** The actor a daemon-started batch carries: itself, never a literal-user act it did not obtain. */
export const LOOP_DAEMON_BATCH_ACTOR = LOOP_DAEMON_ACTOR_ID;

export interface LoopDriveSupervision {
	/** The Host the Lane's Executor runs in. */
	parent_host: string;
	/** The requested Executor profile; sessions open with the effective choice. */
	request?: ExecutorPreferences;
	signal?: AbortSignal;
	stop?: boolean;
}

export interface LoopDriveInput {
	root: string;
	/** The single task this Lane drives; it is also the batch's initiative slug. */
	task_id: string;
	/** The batch to advance, or to create when no active v3 batch drives this task. */
	batch_id: string;
	registry: BatchAuthorityRegistry;
	capability: object;
	children: BatchPlanChild[];
	plan_digest: string;
	base_head: string;
	budget: { max_children: number; qa_failure_limit: number };
	/** The BatchAgreement confirmation: `tracker_approval` or `policy_auto`. */
	confirmation: { source: Extract<BatchConfirmationSource, "tracker_approval" | "policy_auto">; ref: string };
	confirmation_time: string;
	now: string;
	kernel: BatchRunnerKernelPort;
	git?: BatchRunnerGitPort;
	max_parallel?: number;
	supervision: LoopDriveSupervision;
	/** Test seam for the session provider; production resolves the real one and fails closed outside Herdr. */
	createPort?: (provider: string, env: Record<string, string | undefined>) => never;
}

export interface LoopDriveHold {
	task_id: string;
	batch_id: string;
	detail: string;
}

export interface LoopDriveExit {
	state: "exited";
	exit_code: 0;
	generation: number | null;
	final_commit_sha: string | null;
	verification_evidence_digest: string | null;
}

export interface LoopDriveResult {
	settled: boolean;
	/** Present exactly when the child integrated a delivery on the batch branch. */
	exit: LoopDriveExit | null;
	/** Present when the active child waits on a startup or mid-run dialog the daemon cannot answer. */
	hold_for_dialog: LoopDriveHold | null;
	batch_id: string;
	reason: string;
}

function sessionProviders(root: string): string[] {
	try {
		const resolved = resolveConfig(root).session_providers as unknown as { value?: unknown };
		const value = (resolved as { value?: unknown }).value;
		return Array.isArray(value) ? (value as string[]) : ["herdr", "herdr-core"];
	} catch {
		return ["herdr", "herdr-core"];
	}
}

/**
 * Drive one enrolled task through its Lane. First entry authorizes the batch
 * and starts Lanes; every later entry advances the active batch id. Reads
 * completion from the v3 Batch Record plus `.imm/audit/` — never from a
 * process exit.
 */
export async function dispatchLoopDrive(input: LoopDriveInput): Promise<LoopDriveResult> {
	const providers = sessionProviders(input.root);
	const active = findActiveLaneBatchForTask(input.root, input.task_id);
	const batchId = input.batch_id;
	const laneDeps = {
		root: input.root,
		registry: input.registry,
		capability: input.capability,
		kernel: input.kernel,
		...(input.git ? { git: input.git } : {}),
		providers,
		host: input.supervision.parent_host,
		env: { ...process.env } as Record<string, string | undefined>,
		...(input.supervision.request ? { executor: input.supervision.request } : {}),
		max_parallel: 1,
		now: input.now,
		confirmation_time: input.confirmation_time,
		entry_kind: "single_task" as const,
		...(input.createPort ? { createPort: input.createPort as never } : {}),
	};
	if (!active || !isLaneBatchRecord(active.record)) {
		const agreement = authorizeBatch({
			batch_id: batchId,
			initiative_slug: input.task_id,
			children: input.children,
			base_head: input.base_head,
			budget: input.budget,
			confirmation: input.confirmation,
			final_verification: { required: false, commands: [] },
			return_policy: "retain_branch",
			interaction_mode: "parent_relayed",
			actor: LOOP_DAEMON_ACTOR_ID,
		});
		if (!agreement.ok) {
			return { settled: false, exit: null, hold_for_dialog: null, batch_id: batchId, reason: agreement.reason };
		}
		const started = await startLanes(agreement.agreement, laneDeps as never);
		if (started && typeof started === "object" && (started as { ok?: unknown }).ok === false) {
			const refusal = started as { code: string; reason: string; recovery: string };
			return { settled: false, exit: null, hold_for_dialog: null, batch_id: batchId, reason: `${refusal.reason}. ${refusal.recovery}` };
		}
		return { settled: false, exit: null, hold_for_dialog: holdOf(input.root, batchId, input.task_id), batch_id: batchId, reason: "lane started" };
	}
	const advanced = await advanceLanes(input.root, batchId, laneDeps as never);
	if (advanced && typeof advanced === "object" && (advanced as { ok?: unknown }).ok === false) {
		const refusal = advanced as { code: string; reason: string; recovery: string };
		return { settled: false, exit: null, hold_for_dialog: holdOf(input.root, batchId, input.task_id), batch_id: batchId, reason: `${refusal.reason}. ${refusal.recovery}` };
	}
	const record = readAnyBatchRunState(input.root, batchId);
	const child = record && isLaneBatchRecord(record) ? record.children.find(entry => entry.task_id === input.task_id) : undefined;
	const commit = child?.commit ?? null;
	const integrated = child?.state === "integrated" || child?.state === "released";
	const digest = commit ? auditEvidenceDigest(input.root, commit, input.task_id) : null;
	const exit: LoopDriveExit | null = integrated && commit
		? { state: "exited", exit_code: 0, generation: child?.session?.generation ?? null, final_commit_sha: commit, verification_evidence_digest: digest }
		: null;
	return {
		settled: integrated && commit !== null,
		exit,
		hold_for_dialog: integrated ? null : holdOf(input.root, batchId, input.task_id),
		batch_id: batchId,
		reason: integrated ? (digest ? "lane integrated with verification digest" : "lane integrated without audit evidence") : "lane running",
	};
}

/**
 * The daemon has no Host to run an Assurance attempt, so it reports the Lane's
 * Kernel obligation instead of fabricating a verdict. Shared by the drive job
 * and post-relay advances.
 */
export async function daemonAdvanceTask(laneRoot: string, taskId: string) {
	const fresh = await projectAssurance(laneRoot, taskId, undefined);
	if (fresh.projection.lifecycle === "done" && fresh.projection.completion_ready) return { state: "completed" as const };
	return {
		state: "blocked" as const,
		reason: `kernel obligation ${fresh.projection.next_obligation ?? "unknown"} has no daemon Host`,
	};
}

export interface DaemonAdvanceOptions {
	parent_host?: string;
	createPort?: (provider: string, env: Record<string, string | undefined>) => never;
}

/**
 * Re-enter the active batch for one task: re-issues the daemon binding from
 * the v3 record and advances its Lanes. Used after a relayed GitHub/local
 * decision, and by a restarted daemon whose in-memory capability is gone.
 */
export async function advanceDaemonLanes(root: string, batchId: string, options: DaemonAdvanceOptions = {}): Promise<Record<string, unknown>> {
	const record = readAnyBatchRunState(root, batchId);
	if (!record || !isLaneBatchRecord(record)) {
		return { ok: false, code: "lane_session_unavailable", reason: `lane_session_unavailable: no active v3 batch ${batchId}`, recovery: "start a fresh batch" };
	}
	const registry = createBatchAuthorityRegistry();
	const binding = {
		batch_id: record.batch_id,
		initiative_slug: record.initiative_slug,
		plan_digest: record.plan_digest,
		branch: record.branch ?? `imm/${record.initiative_slug}`,
		base_head: record.base_head,
		budget: record.budget,
		actor_id: LOOP_DAEMON_ACTOR_ID,
		confirmation_ref: record.confirmation?.ref ?? `resume:${record.batch_id}`,
		nonce: `resume-${Date.now()}`,
	};
	const identities = record.intent_identities ?? {};
	const authorityChildren = record.children.map(child => {
		const identity = identities[child.task_id];
		return {
			task_id: child.task_id,
			intent_path: identity?.intent_path ?? "",
			intent_revision: identity?.intent_revision ?? 0,
			intent_content_hash: identity?.intent_content_hash ?? "",
			...(identity?.intent_authority_hash ? { intent_authority_hash: identity.intent_authority_hash } : {}),
			blocked_by: [...child.blocked_by],
		};
	});
	const capability = registry.issue(binding, authorityChildren, new Date().toISOString());
	const parent = await observeSingleTask(root, record.initiative_slug);
	const kernel = createBatchKernelPort({
		root,
		parent,
		enrollmentRegistry: createEnrollmentAuthorityRegistry(),
		registry,
		capability,
		binding,
		advanceTask: daemonAdvanceTask,
		resume: { isResuming: true, existingBatch: record, batchBranch: record.branch ?? `imm/${record.initiative_slug}` },
	});
	const config = resolveConfig(root);
	const laneDeps = {
		root,
		registry,
		capability,
		kernel,
		entry_kind: "single_task" as const,
		providers: sessionProviders(root),
		host: options.parent_host ?? config.agents.roles.executor?.host ?? "claude-code",
		env: { ...process.env } as Record<string, string | undefined>,
		...(record.executor_preferences ? { executor: record.executor_preferences } : {}),
		max_parallel: record.max_parallel,
		now: new Date().toISOString(),
		confirmation_time: record.confirmation_time,
		...(options.createPort ? { createPort: options.createPort as never } : {}),
	};
	const advanced = await advanceLanes(root, batchId, laneDeps as never);
	return advanced as unknown as Record<string, unknown>;
}

/** A child waiting on a dialog the unattended daemon cannot answer holds the Lane open. */
function holdOf(root: string, batchId: string, taskId: string): LoopDriveHold | null {
	try {
		const record = readAnyBatchRunState(root, batchId);
		const session = record && isLaneBatchRecord(record)
			? record.children.find(entry => entry.task_id === taskId)?.session ?? null
			: null;
		if (!session) return null;
		if (session.entry_submitted === false)
			return { task_id: taskId, batch_id: batchId, detail: "lane_entry_not_submitted: the Executor session waits on a startup dialog" };
		if (session.attention !== null)
			return { task_id: taskId, batch_id: batchId, detail: `lane_attention: ${session.attention}` };
		return null;
	} catch {
		return null;
	}
}
