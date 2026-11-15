/**
 * Loop Daemon: Background Jobs (S6)
 *
 * Implements D6 of docs/specs/loop-agent-scheduling.spec.md. Long work — a Lane
 * drive, a repair session — runs as one job per target under
 * `.imm/state/loop/jobs/<target>.json` instead of inside the tick, so the tick
 * returns and `owner_control` runs while the job is still working.
 *
 * The job record is orchestration state, never authority (ADR 0039 Decision 4):
 * the Kernel projection and the Executor exit record stay the facts a PR is
 * opened from. A job whose process is gone with no outcome is `lost`; the work
 * item retries it once and escalates the second loss.
 *
 * The lease is what makes `max_concurrent` bind: the tick keeps the lease while
 * the job is nonterminal and releases it in `reconcileLoopJobsForTick()`, which
 * is also where E12 `job_finished` and E13 `lane_settled` are produced.
 */

import { randomUUID } from "node:crypto";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	renameSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { isPidAlive } from "./lock.ts";
import { releaseLoopLease } from "./leases.ts";
import { loadLease } from "./state.ts";
import { LOOP_DAEMON_EVENT_CONTRACT, type NormalizedLoopEvent } from "./types.ts";

export const LOOP_JOB_RECORD_CONTRACT = "assurance_kernel/loop_job_record/v1" as const;

/** One retry: a lost job is restarted once, the second loss escalates. */
export const LOOP_JOB_MAX_ATTEMPTS = 2;

export type LoopJobKind = "drive" | "repair";

export type LoopJobOutcome = "settled" | "failed" | "lost";

/** The Executor exit a settled job observed, as the exit record recorded it. */
export interface LoopJobExit {
	state: string;
	exit_code: number | null;
	generation: number;
	final_commit_sha: string | null;
	verification_evidence_digest: string | null;
}

export interface LoopJobRecord {
	contract: typeof LOOP_JOB_RECORD_CONTRACT;
	/** One job per target, so the id is the target it holds. */
	job_id: string;
	kind: LoopJobKind;
	target_id: string;
	task_id: string;
	issue_number: number | null;
	pid: number;
	started_at: string;
	/** What the job must leave behind before it counts as settled. */
	expected_output: string;
	attempts: number;
	/** Null while the job runs; terminal afterwards. */
	outcome: LoopJobOutcome | null;
	detail: string | null;
	finished_at: string | null;
	exit: LoopJobExit | null;
}

export function loopJobsDir(stateDir: string): string {
	return join(stateDir, "jobs");
}

function jobPath(stateDir: string, targetId: string): string {
	return join(loopJobsDir(stateDir), `${targetId}.json`);
}

function ensureJobsDir(stateDir: string): string {
	const directory = loopJobsDir(stateDir);
	mkdirSync(directory, { recursive: true, mode: 0o700 });
	try {
		chmodSync(directory, 0o700);
	} catch {}
	return directory;
}

export function readLoopJob(stateDir: string, targetId: string): LoopJobRecord | null {
	try {
		const parsed = JSON.parse(readFileSync(jobPath(stateDir, targetId), "utf8")) as LoopJobRecord;
		if (parsed?.contract === LOOP_JOB_RECORD_CONTRACT && parsed.job_id === targetId) return parsed;
	} catch {}
	return null;
}

export function listLoopJobs(stateDir: string): LoopJobRecord[] {
	const directory = loopJobsDir(stateDir);
	if (!existsSync(directory)) return [];
	const jobs: LoopJobRecord[] = [];
	for (const file of readdirSync(directory)) {
		if (!file.endsWith(".json")) continue;
		const job = readLoopJob(stateDir, file.slice(0, -".json".length));
		if (job) jobs.push(job);
	}
	return jobs;
}

export function writeLoopJob(stateDir: string, job: LoopJobRecord): void {
	ensureJobsDir(stateDir);
	const target = jobPath(stateDir, job.job_id);
	const temp = join(loopJobsDir(stateDir), `${job.job_id}.${randomUUID()}.tmp`);
	writeFileSync(temp, `${JSON.stringify(job, null, 2)}\n`, { mode: 0o600 });
	try {
		chmodSync(temp, 0o600);
	} catch {}
	renameSync(temp, target);
	try {
		chmodSync(target, 0o600);
	} catch {}
}

export function isTerminalJob(job: LoopJobRecord): boolean {
	return job.outcome !== null;
}

/** The job currently holding its target's lease, or null when none runs. */
export function activeLoopJob(stateDir: string, targetId: string): LoopJobRecord | null {
	const job = readLoopJob(stateDir, targetId);
	return job && !isTerminalJob(job) ? job : null;
}

export interface StartLoopJobInput {
	kind: LoopJobKind;
	target_id: string;
	task_id: string;
	issue_number: number | null;
	expected_output: string;
	now: string;
	/** The process that runs the work; defaults to this one. */
	pid?: number;
}

/** What one job's work reports when it settles. */
export interface LoopJobCompletion {
	outcome: Exclude<LoopJobOutcome, "lost">;
	detail: string;
	exit?: LoopJobExit | null;
}

/**
 * Write the job record, then run `work` detached: the caller returns to the tick
 * and the record becomes terminal when the work settles. A previous terminal
 * record for the same target is what makes this attempt 2.
 */
export function startLoopJob(
	stateDir: string,
	input: StartLoopJobInput,
	work: () => Promise<LoopJobCompletion>,
): LoopJobRecord {
	const previous = readLoopJob(stateDir, input.target_id);
	const job: LoopJobRecord = {
		contract: LOOP_JOB_RECORD_CONTRACT,
		job_id: input.target_id,
		kind: input.kind,
		target_id: input.target_id,
		task_id: input.task_id,
		issue_number: input.issue_number,
		pid: input.pid ?? process.pid,
		started_at: input.now,
		expected_output: input.expected_output,
		attempts: (previous?.attempts ?? 0) + 1,
		outcome: null,
		detail: null,
		finished_at: null,
		exit: null,
	};
	writeLoopJob(stateDir, job);

	void work().then(
		(completion) => finishLoopJob(stateDir, job.job_id, { ...completion, now: new Date().toISOString() }),
		(error: unknown) =>
			finishLoopJob(stateDir, job.job_id, {
				outcome: "failed",
				detail: error instanceof Error ? error.message : String(error),
				now: new Date().toISOString(),
			}),
	);
	return job;
}

export function finishLoopJob(
	stateDir: string,
	targetId: string,
	input: { outcome: LoopJobOutcome; detail: string; exit?: LoopJobExit | null; now: string },
): LoopJobRecord | null {
	const job = readLoopJob(stateDir, targetId);
	if (!job || isTerminalJob(job)) return job;
	const finished: LoopJobRecord = {
		...job,
		outcome: input.outcome,
		detail: input.detail,
		finished_at: input.now,
		exit: input.exit ?? null,
	};
	writeLoopJob(stateDir, finished);
	return finished;
}

export interface ReconcileLoopJobsFacts {
	now: string;
	is_alive?: (pid: number) => boolean;
}

export interface ReconcileLoopJobsResult {
	/** Jobs this tick saw become terminal (settled, failed or lost). */
	terminal: LoopJobRecord[];
	/** The subset whose process died without an outcome. */
	lost: LoopJobRecord[];
}

/**
 * A dead pid with no outcome is `lost`. Every terminal job releases its target's
 * lease — the lease is held for exactly as long as the job record is nonterminal.
 */
export function reconcileLoopJobs(
	stateDir: string,
	facts: ReconcileLoopJobsFacts,
): ReconcileLoopJobsResult {
	const isAlive = facts.is_alive ?? isPidAlive;
	const terminal: LoopJobRecord[] = [];
	const lost: LoopJobRecord[] = [];
	for (const job of listLoopJobs(stateDir)) {
		let observed = job;
		if (!isTerminalJob(job) && !isAlive(job.pid)) {
			observed =
				finishLoopJob(stateDir, job.job_id, {
					outcome: "lost",
					detail: `job process ${job.pid} is gone with no outcome`,
					now: facts.now,
				}) ?? job;
			lost.push(observed);
		}
		if (!isTerminalJob(observed)) continue;
		terminal.push(observed);
		const lease = loadLease(stateDir, observed.target_id);
		if (lease) releaseLoopLease(stateDir, observed.target_id, { host_token: lease.host_token });
	}
	return { terminal, lost };
}

/**
 * The daemon-internal events one tick derives from the job store: E12
 * `job_finished` for every terminal job, E13 `lane_settled` for the settled ones.
 * Both carry the job's attempt, so a retry is a new fact and an unchanged one is
 * not judged twice.
 */
export function loopJobEvents(stateDir: string, facts: { now: string }): NormalizedLoopEvent[] {
	const events: NormalizedLoopEvent[] = [];
	for (const job of listLoopJobs(stateDir)) {
		if (!isTerminalJob(job) || job.issue_number === null) continue;
		events.push({
			contract: LOOP_DAEMON_EVENT_CONTRACT,
			event_id: `evt-e12-${job.job_id}-${job.attempts}-${job.outcome}`,
			kind: "E12_JOB_FINISHED",
			timestamp: facts.now,
			issue_number: job.issue_number,
			task_id: job.task_id,
			job_id: job.job_id,
			outcome: job.outcome as Exclude<LoopJobOutcome, null>,
			attempts: job.attempts,
			detail: job.detail ?? "",
		});
		if (job.outcome !== "settled") continue;
		events.push({
			contract: LOOP_DAEMON_EVENT_CONTRACT,
			event_id: `evt-e13-${job.job_id}-${job.attempts}`,
			kind: "E13_LANE_SETTLED",
			timestamp: facts.now,
			issue_number: job.issue_number,
			task_id: job.task_id,
			job_id: job.job_id,
			final_commit_sha: job.exit?.final_commit_sha ?? null,
			verification_evidence_digest: job.exit?.verification_evidence_digest ?? null,
		});
	}
	return events;
}
