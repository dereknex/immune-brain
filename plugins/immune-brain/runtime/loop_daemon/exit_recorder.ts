/**
 * Loop Daemon: Executor Exit Record (S5)
 *
 * Implements D6 of docs/specs/loop-daemon.spec.md (BR-REQ-4). A Lane's Executor
 * exits with nothing but a process status; the daemon records that exit as one
 * canonical artifact binding the Kernel run, the final commit and the digest of
 * the verification evidence the Lane left behind, so a later tick reads
 * completion from evidence instead of a session's prose (ADR 0039 Decision 2).
 *
 * The record lives under `.imm/state/loop/`, which is rebuildable orchestration
 * state and never authority (ADR 0039 Decision 4).
 */

import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";

import { ensureLoopStateDir } from "./state.ts";
import type { LaneExit } from "../unattended/lane_supervisor.ts";

export const EXECUTOR_EXIT_RECORD_CONTRACT = "assurance_kernel/executor_exit_record/v1" as const;

/** How the Executor generation ended; a killed generation is not a delivery. */
export type ExecutorExitState = "exited" | "stopped_by_parent" | "interrupted";

export interface ExecutorExitRecord {
	contract: typeof EXECUTOR_EXIT_RECORD_CONTRACT;
	run_id: string;
	task_id: string;
	batch_id: string;
	lane_path: string;
	generation: number;
	pid: number;
	state: ExecutorExitState;
	exit_code: number | null;
	exit_signal: string | null;
	/** The commit the Lane left on its branch, or null when it produced none. */
	final_commit_sha: string | null;
	/** `sha256:` digest of the verification evidence bytes, or null when none was written. */
	verification_evidence_digest: string | null;
	recorded_at: string;
}

export interface RecordExecutorExitInput {
	run_id: string;
	task_id: string;
	batch_id: string;
	lane: LaneExit;
	state: ExecutorExitState;
	final_commit_sha: string | null;
	/** The raw verification evidence; this module owns its digest. */
	verification_evidence: string | null;
	recorded_at: string;
}

/** The daemon's state directory for one repository. */
export function loopStateDir(root: string): string {
	return join(root, ".imm", "state", "loop");
}

export function executorExitPath(stateDir: string, taskId: string): string {
	return join(stateDir, "executor-exits", `${taskId}.executor-exit.json`);
}

/** The one digest spelling for verification evidence. */
export function verificationEvidenceDigest(bytes: string): string {
	return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

export function recordExecutorExit(stateDir: string, input: RecordExecutorExitInput): ExecutorExitRecord {
	ensureLoopStateDir(stateDir);
	const exitDir = join(stateDir, "executor-exits");
	mkdirSync(exitDir, { recursive: true, mode: 0o700 });
	try {
		chmodSync(exitDir, 0o700);
	} catch {}

	const record: ExecutorExitRecord = {
		contract: EXECUTOR_EXIT_RECORD_CONTRACT,
		run_id: input.run_id,
		task_id: input.task_id,
		batch_id: input.batch_id,
		lane_path: input.lane.lane_path,
		generation: input.lane.generation,
		pid: input.lane.pid,
		state: input.state,
		exit_code: input.lane.code,
		exit_signal: input.lane.signal,
		final_commit_sha: input.final_commit_sha,
		verification_evidence_digest:
			input.verification_evidence === null ? null : verificationEvidenceDigest(input.verification_evidence),
		recorded_at: input.recorded_at,
	};

	const target = executorExitPath(stateDir, input.task_id);
	const temp = `${target}.${randomUUID()}.tmp`;
	writeFileSync(temp, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
	try {
		chmodSync(temp, 0o600);
	} catch {}
	renameSync(temp, target);
	try {
		chmodSync(target, 0o600);
	} catch {}
	return record;
}

/** The recorded exit for one task, or null when the daemon never recorded one. */
export function readExecutorExit(stateDir: string, taskId: string): ExecutorExitRecord | null {
	const target = executorExitPath(stateDir, taskId);
	if (!existsSync(target)) return null;
	try {
		const parsed = JSON.parse(readFileSync(target, "utf8")) as ExecutorExitRecord;
		return parsed && parsed.contract === EXECUTOR_EXIT_RECORD_CONTRACT ? parsed : null;
	} catch {
		return null;
	}
}
