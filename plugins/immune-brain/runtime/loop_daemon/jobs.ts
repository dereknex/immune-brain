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

import { execFileSync } from "node:child_process";
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

/**
 * A job still running this long after it started is `failed` as timed out, so
 * its lease is released and the owner is told; it is never restarted
 * automatically, because its work may still be running in this process.
 */
export const LOOP_JOB_MAX_RUNTIME_MS = 12 * 60 * 60 * 1000;

export type LoopJobKind = "drive" | "repair";

export type LoopJobOutcome = "settled" | "failed" | "lost";

/** The delivery a settled job observed, as the v3 Batch Record plus `.imm/audit/` prove it. */
export interface LoopJobExit {
	state: string;
	exit_code: number | null;
	generation: number | null;
	final_commit_sha: string | null;
	verification_evidence_digest: string | null;
}

/** One Lane of a job's plan batch that settled, with the exit it settled on. */
export interface LoopJobLane {
	task_id: string;
	exit: LoopJobExit | null;
}

export interface LoopJobRecord {
	contract: typeof LOOP_JOB_RECORD_CONTRACT;
	/** One job per target, so the id is the target it holds. */
	job_id: string;
	kind: LoopJobKind;
	target_id: string;
	task_id: string;
	issue_number: number | null;
	/** The approved plan digest the job drives; a PR opens only while it is still the published one. */
	plan_digest?: string | null;
	/** Every task the job drives, in plan order; a retry of a lost job drives the same set. */
	task_ids?: string[];
	/** The Lanes that settled so far, in plan order; a retry skips them and each opens its own PR. */
	settled_lanes?: LoopJobLane[];
	pid: number;
	/** The process start time of `pid` when the job started; a different one means the pid was reused. */
	pid_started_at?: string | null;
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
	plan_digest?: string | null;
	task_ids?: string[];
	/** The process that runs the work; defaults to this one. */
	pid?: number;
	/** Reads a pid's process start time; defaults to `ps`. */
	process_started_at?: (pid: number) => string | null;
}

/** The start time `ps` reports for `pid`, or null when it cannot be read. */
export function processStartedAt(pid: number): string | null {
	try {
		const out = execFileSync("ps", ["-o", "lstart=", "-p", String(pid)], {
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
		}).trim();
		return out === "" ? null : out;
	} catch {
		return null;
	}
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
	const pid = input.pid ?? process.pid;
	// A retry of the same plan keeps the Lanes the lost attempt already settled.
	const carried =
		previous && previous.outcome === "lost" && (previous.plan_digest ?? null) === (input.plan_digest ?? null)
			? (previous.settled_lanes ?? [])
			: [];
	const job: LoopJobRecord = {
		contract: LOOP_JOB_RECORD_CONTRACT,
		job_id: input.target_id,
		kind: input.kind,
		target_id: input.target_id,
		task_id: input.task_id,
		issue_number: input.issue_number,
		plan_digest: input.plan_digest ?? null,
		task_ids: input.task_ids ?? [input.task_id],
		settled_lanes: carried,
		pid,
		pid_started_at: (input.process_started_at ?? processStartedAt)(pid),
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

/** Record one settled Lane of a running job, so a lost attempt's retry does not drive it again. */
export function recordSettledLane(stateDir: string, targetId: string, lane: LoopJobLane): LoopJobRecord | null {
	const job = readLoopJob(stateDir, targetId);
	if (!job || isTerminalJob(job)) return job;
	const lanes = (job.settled_lanes ?? []).filter((entry) => entry.task_id !== lane.task_id);
	const next: LoopJobRecord = { ...job, settled_lanes: [...lanes, lane] };
	writeLoopJob(stateDir, next);
	return next;
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
	process_started_at?: (pid: number) => string | null;
	max_runtime_ms?: number;
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
	const startedAt = facts.process_started_at ?? processStartedAt;
	const maxRuntime = facts.max_runtime_ms ?? LOOP_JOB_MAX_RUNTIME_MS;
	const terminal: LoopJobRecord[] = [];
	const lost: LoopJobRecord[] = [];
	for (const job of listLoopJobs(stateDir)) {
		let observed = job;
		if (!isTerminalJob(job)) {
			// A live pid whose start time moved is another process that reused it.
			const reused =
				isAlive(job.pid) && Boolean(job.pid_started_at) && startedAt(job.pid) !== job.pid_started_at;
			if (!isAlive(job.pid) || reused) {
				observed =
					finishLoopJob(stateDir, job.job_id, {
						outcome: "lost",
						detail: reused
							? `job process ${job.pid} was replaced by another process with no outcome`
							: `job process ${job.pid} is gone with no outcome`,
						now: facts.now,
					}) ?? job;
				lost.push(observed);
			} else if (Date.parse(facts.now) - Date.parse(job.started_at) > maxRuntime) {
				observed =
					finishLoopJob(stateDir, job.job_id, {
						outcome: "failed",
						detail: `job_timed_out: still running ${Math.round(maxRuntime / 60000)} minutes after ${job.started_at}`,
						now: facts.now,
					}) ?? job;
			}
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
		// D8: every settled Lane of the plan batch opens its own PR.
		const lanes: LoopJobLane[] =
			job.settled_lanes && job.settled_lanes.length > 0 ? job.settled_lanes : [{ task_id: job.task_id, exit: job.exit }];
		for (const lane of lanes) {
			events.push({
				contract: LOOP_DAEMON_EVENT_CONTRACT,
				event_id:
					lanes.length === 1 && lane.task_id === job.task_id
						? `evt-e13-${job.job_id}-${job.attempts}`
						: `evt-e13-${job.job_id}-${job.attempts}-${lane.task_id}`,
				kind: "E13_LANE_SETTLED",
				timestamp: facts.now,
				issue_number: job.issue_number,
				task_id: lane.task_id,
				job_id: job.job_id,
				...(job.plan_digest ? { plan_digest: job.plan_digest } : {}),
				final_commit_sha: lane.exit?.final_commit_sha ?? null,
				verification_evidence_digest: lane.exit?.verification_evidence_digest ?? null,
			});
		}
	}
	return events;
}
