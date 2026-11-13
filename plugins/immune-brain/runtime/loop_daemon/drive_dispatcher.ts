/**
 * Loop Daemon: Drive Dispatcher — the 4th Composition Root (S5)
 *
 * Implements D6 of docs/specs/loop-daemon.spec.md (BR-REQ-4, BR-SCN-2). ADR 0039
 * Decision 2 makes the daemon a headless Parent: it calls `startBatch` and
 * `LaneSupervisor` exactly as the three Host adapters do, and owns no batch
 * state transition of its own (ADR 0005 Decision 4 stands). Everything this
 * module decides is which `StartBatchInput` to hand the shared driver and where
 * to record the Executor exit it observed; the batch itself does the rest.
 */

import type { BatchRunnerGitPort } from "../unattended/batch_git";
import {
	startBatch,
	type BatchRunReport,
	type BatchRunnerKernelPort,
	type BatchTrackerPort,
	type StartBatchInput,
} from "../unattended/batch_runner";
import type { BatchLaneRunReport } from "../unattended/batch_state";
import { LaneSupervisor, type ExecutorHost, type ExecutorPreferences } from "../unattended/lane_supervisor";
import type { BatchAuthorityRegistry } from "../kernel/batch_authority";
import { LOOP_DAEMON_ACTOR_ID } from "../kernel/actor_identity";
import {
	loopStateDir,
	recordExecutorExit,
	type ExecutorExitRecord,
	type ExecutorExitState,
} from "./exit_recorder.ts";

/** The daemon's composition-root name, as ADR 0039 Decision 2 records it. */
export const LOOP_DAEMON_COMPOSITION_ROOT = "loop_daemon";

/** The actor a daemon-started batch carries: itself, never a literal-user act it did not obtain. */
export const LOOP_DAEMON_BATCH_ACTOR = LOOP_DAEMON_ACTOR_ID;

export interface LoopDriveSupervision {
	/** The Host the Lane's Executor runs in. */
	parent_host: ExecutorHost;
	/** The plugin directory that Executor Host loads. */
	plugin_dir: string;
	/** How long one `startBatch` call supervises the generation before returning. */
	wait_ms: number;
	request?: ExecutorPreferences;
	signal?: AbortSignal;
	stop?: boolean;
}

export interface LoopDriveInput {
	root: string;
	batch_id: string;
	/** The single task this Lane drives; it is also the batch's initiative slug. */
	initiative_slug: string;
	registry: BatchAuthorityRegistry;
	capability: object;
	children: StartBatchInput["children"];
	plan_digest: string;
	base_head: string;
	confirmation_time: string;
	budget: { max_children: number; qa_failure_limit: number };
	now: string;
	kernel: BatchRunnerKernelPort;
	git?: BatchRunnerGitPort;
	tracker?: BatchTrackerPort;
	max_parallel?: number;
	supervision: LoopDriveSupervision;
	/** The Kernel run the Lane serves; bound into the exit record. */
	run_id: string;
	final_commit_sha?: string | null;
	/** The Lane's raw verification evidence; its digest is bound into the exit record. */
	verification_evidence?: string | null;
	/** Defaults to `<root>/.imm/state/loop`. */
	state_dir?: string;
	/** Seam for tests; the daemon always uses the shared driver. */
	start_batch?: typeof startBatch;
	start?: LaneSupervisor;
}

export interface LoopDriveResult {
	report: BatchRunReport;
	/** Present exactly when this call observed an Executor exit. */
	exit_record: ExecutorExitRecord | null;
}

/** What this call observed of the Lane's generation; only lane mode reports it. */
type LaneSupervision = NonNullable<BatchLaneRunReport["lane_supervision"]>;

/**
 * The daemon holds one supervisor for its lifetime: a `LaneSupervisor` keeps the
 * live child handles of its own process, and a fresh one per tick would report a
 * running generation as unobservable.
 */
export const loopDaemonSupervisor = new LaneSupervisor();

/** A killed generation is not a delivery, so its recorder state follows how it ended. */
function exitStateOf(supervision: LaneSupervision | undefined): ExecutorExitState {
	if (!supervision) return "exited";
	if (supervision.state === "stopped") return "interrupted";
	return supervision.exit?.signal ? "stopped_by_parent" : "exited";
}

/**
 * Drive one enrolled task through its Lane. This is the whole composition root:
 * compose the single-task `StartBatchInput`, let the shared driver run and
 * supervise the Lane, then record the Executor exit it observed.
 */
export async function dispatchLoopDrive(input: LoopDriveInput): Promise<LoopDriveResult> {
	const driver = input.start_batch ?? startBatch;
	const supervision = input.supervision;
	const report = await driver({
		plan_source: "single_task",
		supervision: {
			supervisor: input.start ?? loopDaemonSupervisor,
			parentHost: supervision.parent_host,
			pluginDir: supervision.plugin_dir,
			waitMs: supervision.wait_ms,
			stop: supervision.stop,
			...(supervision.request ? { request: supervision.request } : {}),
			...(supervision.signal ? { signal: supervision.signal } : {}),
		},
		root: input.root,
		batch_id: input.batch_id,
		initiative_slug: input.initiative_slug,
		registry: input.registry,
		capability: input.capability,
		children: input.children,
		plan_digest: input.plan_digest,
		base_head: input.base_head,
		confirmation_time: input.confirmation_time,
		budget: input.budget,
		now: input.now,
		kernel: input.kernel,
		...(input.git ? { git: input.git } : {}),
		...(input.tracker ? { tracker: input.tracker } : {}),
		...(input.max_parallel !== undefined ? { max_parallel: input.max_parallel } : {}),
	} satisfies StartBatchInput);

	const exit = (report as BatchRunReport & { lane_supervision?: LaneSupervision }).lane_supervision?.exit ?? null;
	if (!exit) return { report, exit_record: null };
	const exit_record = recordExecutorExit(input.state_dir ?? loopStateDir(input.root), {
		run_id: input.run_id,
		task_id: input.initiative_slug,
		batch_id: input.batch_id,
		lane: exit,
		state: exitStateOf((report as BatchRunReport & { lane_supervision?: LaneSupervision }).lane_supervision),
		final_commit_sha: input.final_commit_sha ?? null,
		verification_evidence: input.verification_evidence ?? null,
		recorded_at: new Date().toISOString(),
	});
	return { report, exit_record };
}
