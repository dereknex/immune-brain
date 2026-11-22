/**
 * Loop Daemon: CLI Surface (S1)
 *
 * Implements S1 and D2 of docs/specs/loop-daemon.spec.md.
 * Exposes:
 *   - imm-loop start [--interval <sec>] [--dry-run] [--json]
 *   - imm-loop stop [--timeout <sec>] [--force] [--json]
 *   - imm-loop logs [--lines <n>] [--json]
 *   - imm-loop tick [--dry-run] [--json]
 *   - imm-loop status [--json]
 *   - imm-loop pause [--reason <text>]
 *   - imm-loop resume
 *   - imm-loop retire-lease <target-id>
 *   - imm-loop rebuild [--json]
 *   - imm-loop run [--interval <sec>] [--dry-run]
 */

import { spawn } from "node:child_process";
import { chmodSync, closeSync, existsSync, fstatSync, mkdtempSync, openSync, readSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { DEFAULT_LOOP_CONFIG, LOOP_LEADER_WAKES_BOUNDS, type LoopConfig, resolveConfig } from "../config/layered_config.ts";
import { createGhTransport, type GhTransport } from "../github_issue_tracker.ts";
import { readTaskRecordRaw } from "../kernel/storage.ts";
import { projectAssurance } from "../kernel/assurance_projection.ts";
import type { LaneSessionsDeps } from "../lane_sessions/index.ts";
import { findLaneRelayTarget, type relayLaneDecision } from "../unattended/lane_decision.ts";
import { POINT_REGISTRY } from "../decision_model/thresholds.ts";
import { buildDecisionRecord } from "./decision_record.ts";
import { selectBestDuplicateCandidate } from "./duplicate_candidates.ts";
import { loopSessionLimits, runAgentSession, sessionEnvironment, type AgentSessionKind, type AgentSessionProvider } from "./agent_runner.ts";
import { readBatchSummaries, recordLeaderWake, runLeaderTick } from "./leader_agent.ts";
import { applyLeaderProposal, parseInitiativePlan, type InitiativePlan, type LeaderDispatchDeps } from "./leader_dispatch.ts";
import { reconcileCandidates } from "./reconcile.ts";
import { reapOrphanedRoleSessions, runningRoleSessions } from "./role_sessions.ts";
import type { ResolvedLoopRole } from "./role_catalog.ts";
import {
	createAgentHandlerPort,
	createDefaultAgentHandlerDeps,
	loadPublishedPlanDigests,
	type AgentHandlerPort,
} from "./agent_handlers.ts";
import { createDefaultRelayInputFactory, dispatchDecisions, type LaneRuntimeFactory, type RelayInputFactory } from "./dispatch.ts";
import { createLoopGitHubPort, type LoopGitHubPort } from "./github_port.ts";
import { type GuardFacts, eventTarget } from "./guards.ts";
import { detectIdentityPosture, inspectDaemonIdentity, readAuthenticatedGithubLogin } from "./identity.ts";
import {
	applyLocalLaneDecisionAnswers,
	createLocalInteractionChannel,
	localClarifyAnswerDecisions,
	localDecisionRecordRevision,
} from "./interaction/local_channel.ts";
import { createGithubInteractionChannel } from "./interaction/github_channel.ts";
import { askOwnerQuestion, batchStateForTarget, collectResolveFacts } from "./replan.ts";
import { resolveSubject } from "./leader_dispatch.ts";
import { clearWaitingPointer, listWaitingStatus } from "./waiting.ts";
import { loopJobEvents, reconcileLoopJobs } from "./jobs.ts";
import {
	type ClassifyFn,
	createDecisionModelClassifier,
	judgeEvents,
	type JudgingBudgetTracker,
} from "./judgement.ts";
import { acquireDaemonLock, cleanStaleDaemonLock, isPidAlive, readDaemonLock } from "./lock.ts";
import { observeGithub } from "./observer.ts";
import { rebuildLoopState } from "./rebuild.ts";
import { reconcileSkippedDecisions, shouldRunScheduledReconcile } from "./reconcile.ts";
import {
	ensureWorkItems,
	listWorkItems,
	pendingClarifyInteractions,
	recordJudgedEvents,
	recordWorkItemOutcome,
	selectUnjudgedEvents,
	type JudgedEventSelection,
} from "./work_items.ts";
import { readLeaderJournal } from "./leader_journal.ts";
import { discardAbandonedBatches, type DiscardTickEntry } from "./discard.ts";
import { applySteeringRequests } from "./steering.ts";
import { loadRepairRetries } from "./repair_agent.ts";
import { budgetExhausted, type ScheduleBudget } from "./scheduler.ts";
import {
	appendLoopDecision,
	appendLoopEvent,
	deleteLease,
	ensureLoopStateDir,
	initLoopState,
	inspectLoopDaemonState,
	loadLoopState,
	rollDailyStats,
	saveLoopState,
} from "./state.ts";
import type { ObservationInput } from "./types.ts";

export interface CliOutput {
	stdout: string;
	stderr: string;
	returncode: number;
}

function jsonOutput(payload: unknown): string {
	return `${JSON.stringify(payload, null, 2)}\n`;
}

function parseStateDirArg(argv: string[]): {
	args: string[];
	stateDirArg: string | null;
	error?: string;
} {
	const cleaned: string[] = [];
	let stateDirArg: string | null = null;
	for (let i = 0; i < argv.length; i++) {
		const token = argv[i]!;
		if (token === "--state-dir") {
			const val = argv[i + 1];
			if (!val || val.startsWith("-")) {
				return { args: argv, stateDirArg: null, error: "Error: --state-dir requires a path\n" };
			}
			stateDirArg = val;
			i++;
			continue;
		}
		if (token.startsWith("--state-dir=")) {
			const val = token.slice("--state-dir=".length);
			if (!val) {
				return { args: argv, stateDirArg: null, error: "Error: --state-dir requires a path\n" };
			}
			stateDirArg = val;
			continue;
		}
		cleaned.push(token);
	}
	return { args: cleaned, stateDirArg };
}

function parsePositiveIntFlag(
	args: string[],
	flag: string,
	defaultValue: number,
	maxValue = Number.MAX_SAFE_INTEGER,
): { value: number; error?: string } {
	const eqPrefix = `${flag}=`;
	const idx = args.findIndex((arg) => arg === flag || arg.startsWith(eqPrefix));
	if (idx < 0) {
		return { value: defaultValue };
	}
	const token = args[idx]!;
	const raw = token.startsWith(eqPrefix) ? token.slice(eqPrefix.length) : args[idx + 1];
	if (!raw || !/^[1-9]\d*$/.test(raw)) {
		return { value: defaultValue, error: `Error: ${flag} requires a positive integer\n` };
	}
	const parsed = Number.parseInt(raw, 10);
	if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maxValue) {
		return {
			value: defaultValue,
			error:
				maxValue === Number.MAX_SAFE_INTEGER
					? `Error: ${flag} requires a positive integer\n`
					: `Error: ${flag} requires an integer between 1 and ${maxValue}\n`,
		};
	}
	return { value: parsed };
}

function readLogTailLines(logPath: string, maxLines: number): string[] {
	if (!existsSync(logPath) || maxLines <= 0) return [];
	let fd: number | null = null;
	try {
		fd = openSync(logPath, "r");
		const size = fstatSync(fd).size;
		if (size === 0) return [];
		const maxBytes = Math.min(size, Math.max(65536, maxLines * 512));
		const offset = size - maxBytes;
		const buf = Buffer.allocUnsafe(maxBytes);
		let bytesReadTotal = 0;
		while (bytesReadTotal < maxBytes) {
			const n = readSync(
				fd,
				buf,
				bytesReadTotal,
				maxBytes - bytesReadTotal,
				offset + bytesReadTotal,
			);
			if (n <= 0) break;
			bytesReadTotal += n;
		}
		let text = buf.toString("utf8", 0, bytesReadTotal);
		if (offset > 0) {
			const firstNl = text.indexOf("\n");
			text = firstNl >= 0 ? text.slice(firstNl + 1) : "";
		}
		const lines = text.split(/\r?\n/);
		if (lines.length > 0 && lines[lines.length - 1] === "") {
			lines.pop();
		}
		return lines.slice(-maxLines);
	} catch {
		return [];
	} finally {
		if (fd !== null) {
			try {
				closeSync(fd);
			} catch {}
		}
	}
}

export interface SpawnDaemonParams {
	root: string;
	stateDir: string;
	intervalSec: number;
	dryRun: boolean;
	logPath: string;
}

export interface SpawnDaemonHandle {
	pid: number;
	hasExited?: () => boolean;
}

function spawnDetachedDaemonProcess(params: SpawnDaemonParams): SpawnDaemonHandle {
	const defaultStateDir = join(params.root, ".imm/state/loop");
	const v4RuntimePath = fileURLToPath(new URL("../v4_runtime.ts", import.meta.url));
	const childArgs = [
		v4RuntimePath,
		"cli",
		"imm-loop",
		"run",
		"--interval",
		String(params.intervalSec),
		...(params.dryRun ? ["--dry-run"] : []),
		...(params.stateDir !== defaultStateDir ? ["--state-dir", params.stateDir] : []),
	];
	const logFd = openSync(params.logPath, "a", 0o600);
	try {
		try {
			chmodSync(params.logPath, 0o600);
		} catch {}
		const child = spawn(process.execPath, childArgs, {
			cwd: params.root,
			env: process.env,
			detached: true,
			stdio: ["ignore", logFd, logFd],
		});
		if (!child.pid) {
			throw new Error("spawn returned no PID");
		}
		let exited = false;
		child.once("exit", () => {
			exited = true;
		});
		child.once("error", () => {
			exited = true;
		});
		child.unref();
		return { pid: child.pid, hasExited: () => exited };
	} finally {
		closeSync(logFd);
	}
}

/** The session kind one catalog base's role runs as (Spec loop-leader D1.2). */
const ROLE_SESSION_KIND: Record<string, AgentSessionKind> = {
	clarify: "clarify",
	plan: "planning",
	repair: "repair",
	analyze: "analyze",
};

function roleEntryPrompt(role: ResolvedLoopRole, subject: string, brief: string): string {
	return [
		`You are the Loop's \`${role.name}\` role (base \`${role.base}\`).`,
		`Subject: ${subject}`,
		"",
		brief,
		"",
		"Report what you found.",
	].join("\n");
}

/**
 * Start one catalog role session for an accepted `dispatch` (D3.5). A read-only
 * base runs in an empty directory it cannot write; a `repair` base runs in the
 * daemon's own PR worktree and must leave a new commit there as its evidence.
 */
export function createRoleSessionRunner(input: {
	provider: AgentSessionProvider;
	root: string;
	stateDir: string;
	snapshot: ObservationInput;
}): LeaderDispatchDeps["startSession"] {
	return async ({ role, subject, brief, target }) => {
		const kind = ROLE_SESSION_KIND[role.base];
		if (kind === undefined) return { completed: false, reason: `role_base_not_dispatchable: ${role.base}` };
		const limits = { turn_budget: role.limits.turn_budget, timeout_ms: role.limits.timeout_s * 1000 };
		// D3.5: the session runs on the dispatched role's own profile, not the
		// first role of its base, so two roles on one base stay distinct.
		const profile = { host: role.host, model: role.model, effort: role.effort, instructions: role.instructions };
		if (role.base === "repair") {
			const prNumber = /^pr-(\d+)$/.exec(target);
			const pr = prNumber ? input.snapshot.pull_requests.find((entry) => entry.number === Number(prNumber[1])) : undefined;
			if (!pr) return { completed: false, reason: "repair_outside_daemon_branch" };
			const worktree = createDefaultAgentHandlerDeps(input.root, { stateDir: input.stateDir }).prWorktree({
				root: input.root,
				pr_number: pr.number,
				branch: pr.head_ref_name,
				head_sha: pr.head_sha,
			});
			const record = await runAgentSession(
				{ kind, worktree_path: worktree, prompt: roleEntryPrompt(role, subject, brief), ...limits, env: sessionEnvironment(null), profile },
				input.provider,
				{ branch: pr.head_ref_name, expect_head_change: true },
			);
			return { completed: record.status === "completed", reason: `${record.status}: ${record.reason}` };
		}
		const directory = mkdtempSync(join(tmpdir(), "imm-loop-role-"));
		try {
			const record = await runAgentSession(
				{ kind, worktree_path: directory, prompt: roleEntryPrompt(role, subject, brief), ...limits, env: sessionEnvironment(null), profile },
				input.provider,
			);
			return { completed: record.status === "completed", reason: `${record.status}: ${record.reason}` };
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	};
}

/**
 * The Host a discarded Lane's session port is resolved for: the configured
 * executor Host, else claude-code. A value outside the Executor Hosts is refused
 * here rather than cast through the discard dependency's type.
 */
type LaneExecutorHost = LaneSessionsDeps["host"];
const LANE_EXECUTOR_HOSTS = ["claude-code", "pi", "antigravity"] as const satisfies readonly LaneExecutorHost[];

function laneExecutorHost(host: string | null | undefined): LaneExecutorHost {
	if (host === undefined || host === null) return "claude-code";
	const known = LANE_EXECUTOR_HOSTS.find((candidate) => candidate === host);
	if (known) return known;
	throw new Error(`executor host ${host} is not one of ${LANE_EXECUTOR_HOSTS.join(", ")}`);
}

/** The one reply the plan role returns for an Initiative shape (D3.3). */
function initiativePlanPrompt(target: string, reason: string): string {
	return [
		"You are the Loop's plan role. Split one piece of work into ordered slices.",
		"Read nothing outside this directory. Decide, then print exactly one JSON object and nothing else:",
		`{"contract": "immune_brain/loop_initiative_plan/v1", "slug": "<initiative-slug>", "slices": [{"slice_id": "<id>", "result": "<what the slice delivers>", "path": "docs/plans/<task-id>.intent.json", "intent": {...}, "blocked_by": ["<slice_id>"]}]}`,
		"Each `intent` is one complete TaskIntent the Kernel can author, with its own `task_id`.",
		"Each slice's `path` must be exactly `docs/plans/<task-id>.intent.json` for that intent's `task_id`: the drive reads every slice back through that path.",
		"`blocked_by` lists the `slice_id`s of earlier slices of this same plan, never a `task_id`; an unknown or self-referencing id rejects the whole plan.",
		"Leave `blocked_by` out when the slice has no predecessor.",
		"",
		`Target: ${target}`,
		`Reason: ${reason}`,
	].join("\n");
}

/** Run the plan role once, and read its Initiative slices from the session record. */
export function createInitiativePlanner(input: {
	provider: AgentSessionProvider;
	turn_budget: number;
	timeout_ms: number;
}): (input: { target: string; reason: string }) => Promise<InitiativePlan | null> {
	return async ({ target, reason }) => {
		const directory = mkdtempSync(join(tmpdir(), "imm-loop-initiative-"));
		try {
			const record = await runAgentSession(
				{
					kind: "planning",
					worktree_path: directory,
					prompt: initiativePlanPrompt(target, reason),
					turn_budget: input.turn_budget,
					timeout_ms: input.timeout_ms,
					env: sessionEnvironment(null),
				},
				input.provider,
			);
			return record.status === "completed" && record.output !== null ? parseInitiativePlan(record.output) : null;
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	};
}

export async function runLoopDaemonCli(
	argv: string[],
	root: string = process.cwd(),
	options?: {
		gh?: GhTransport;
		gitHubPort?: LoopGitHubPort;
		stateDir?: string;
		snapshotOverride?: ObservationInput;
		lockHeld?: boolean;
		singleIteration?: boolean;
		/** Decision-model seam; production runs resolve the user's point bindings. */
		classify?: ClassifyFn;
		/** Configured enabled points override; defaults to every point `decision_models.bindings` does not turn `off`. */
		enabledPoints?: readonly string[];
		/** Facts the caller owns (budget, leases, identity posture, retry cap). */
		guardFacts?: Partial<GuardFacts>;
		loopConfig?: LoopConfig;
		userConfigPath?: string;
		isShutdownRequested?: () => boolean;
		shutdownRequested?: boolean;
		sleep?: (seconds: number) => Promise<void> | void;
		relayDecision?: typeof relayLaneDecision;
		relayInputFactory?: RelayInputFactory<unknown>;
		/** The Host adapter's Lane-root runtime for Lane decision relays. */
		laneRuntime?: LaneRuntimeFactory;
		/** The S9 agent port; the executable composes the production one. */
		agentPort?: AgentHandlerPort;
		/** The leader session backend; absent compiles the briefing but starts no leader session. */
		leader?: {
			provider: AgentSessionProvider;
			/** The plan role's Initiative slices for a `shape{plan:"initiative"}` item. */
			planInitiative?: (input: { target: string; reason: string }) => Promise<InitiativePlan | null>;
			/** `imm-kernel intent author --stdin --json`, for the carrier's TaskIntents. */
			runKernel?: LeaderDispatchDeps["runKernel"];
		};
		/** True only inside the standing `imm-loop run` process. */
		standingDaemon?: boolean;
		/** Test seam for the Lane session provider the abandon discard closes sessions through. */
		createPort?: Parameters<typeof discardAbandonedBatches>[0]["createPort"];
		/** Deterministic clock seam for reconciliation schedule tests. */
		now?: () => string;
		/** Subprocess seams for testing `start` and `stop` lifecycle deterministically. */
		spawnDaemon?: (params: SpawnDaemonParams) => SpawnDaemonHandle;
		killProcess?: (pid: number, signal: NodeJS.Signals | number) => void;
		isProcessAlive?: (pid: number) => boolean;
		startupTimeoutMs?: number;
		stopTimeoutMs?: number;
	},
): Promise<CliOutput> {
	const absoluteRoot = resolve(root);
	const parsedState = parseStateDirArg(argv);
	if (parsedState.error) {
		return { stdout: "", stderr: parsedState.error, returncode: 2 };
	}
	const normalizedArgv = parsedState.args;
	const stateDir =
		options?.stateDir ??
		(parsedState.stateDirArg
			? resolve(absoluteRoot, parsedState.stateDirArg)
			: join(absoluteRoot, ".imm/state/loop"));

	const command = normalizedArgv[0];
	const args = normalizedArgv.slice(1);

	if (!command || command === "--help" || command === "-h" || command === "help") {
		const usage = `Usage: imm-loop <command> [options]

Commands:
  start [--interval <sec>] [--dry-run] [--json]  Start detached background loop daemon
  stop [--timeout <sec>] [--force] [--json]      Stop running background loop daemon
  logs [--lines <n>] [--json]                    Show recent lines from daemon.log
  tick [--dry-run] [--json]                      Run a single observation and event normalization tick
  status [--json]                                Show loop daemon status, lock, watermarks, and active leases
  pause [--reason <text>]                        Pause the daemon from scheduling new work
  resume                                         Resume scheduling for the daemon
  retire-lease <target-id>                       Manually retire/remove an active lease
  rebuild [--json]                               Reconstruct state and leases from GitHub and repository evidence
  reconcile [--dry-run] [--json]                 Collect model-skipped decisions as leader reconcile candidates
  run [--interval <sec>] [--dry-run]             Run standing loop daemon process in foreground

Options:
  --dry-run                                      Do not mutate state, lock, or repository
  --json                                         Output structured JSON
  --state-dir <path>                             Override daemon state directory
`;
		return { stdout: usage, stderr: "", returncode: command ? 0 : 2 };
	}

	const resolved = resolveConfig(absoluteRoot, { userConfigPath: options?.userConfigPath });
	const loopConfig: LoopConfig =
		options?.loopConfig ??
		(resolved.loop?.valid ? (resolved.loop.value as LoopConfig) : null) ??
		DEFAULT_LOOP_CONFIG;

	const checkRunPreflight = async (isDryRun: boolean): Promise<CliOutput | null> => {
		if (!options?.loopConfig && resolved.loop.valid === false) {
			return {
				stdout: "",
				stderr: "Error: invalid loop configuration\n",
				returncode: 1,
			};
		}

		if (!isDryRun) {
			if (loopConfig.mode === "off") {
				return {
					stdout: "",
					stderr: "Error: loop.mode is off\n",
					returncode: 1,
				};
			}

			const gh = options?.gh ?? createGhTransport();
			const daemonLogin =
				options?.guardFacts?.daemon_identity ??
				(await readAuthenticatedGithubLogin(gh, absoluteRoot));
			if (!daemonLogin) {
				return {
					stdout: "",
					stderr: "Error: unreadable daemon GitHub identity\n",
					returncode: 1,
				};
			}

			if (loopConfig.allowed_actors && loopConfig.allowed_actors.includes(daemonLogin)) {
				return {
					stdout: "",
					stderr: `Error: daemon GitHub identity '${daemonLogin}' is in loop.allowed_actors\n`,
					returncode: 1,
				};
			}
		}

		return null;
	};

	if (command === "status") {
		const isJson = args.includes("--json");
		const snapshot = inspectLoopDaemonState(stateDir);

		if (snapshot.state_error) {
			return {
				stdout: "",
				stderr: `Error: ${snapshot.state_error}\n`,
				returncode: 1,
			};
		}

		const fallbackState = snapshot.watermarks === null ? initLoopState() : null;
		const watermarks = snapshot.watermarks ?? fallbackState!.watermarks;
		const stats = snapshot.stats ?? fallbackState!.stats;
		const updatedAt = snapshot.updated_at ?? fallbackState!.updated_at;
		const mode = resolved.loop?.valid === false ? "invalid" : loopConfig.mode;

		// S5/D5.4: the paused items the owner set locally, and what the leader last did.
		const leaderJournal = readLeaderJournal(stateDir);
		const lastWake = [...leaderJournal].reverse().find((entry) => entry.kind === "wake") ?? null;
		const lastProposal = [...leaderJournal].reverse().find((entry) => entry.kind === "proposal") ?? null;
		const projection = {
			daemon_running: snapshot.daemon_running,
			lock: snapshot.lock,
			mode,
			paused: snapshot.paused,
			pause_reason: snapshot.pause_reason,
			paused_items: listWorkItems(stateDir)
				.filter((item) => item.paused === true)
				.map((item) => ({ target: item.target, state: item.state, updated_at: item.updated_at })),
			// ULS D5.3: items held by the environment, shown here and nowhere in the leader's counters.
			environment_blocked_items: listWorkItems(stateDir)
				.filter((item) => (item.environment_blocked ?? null) !== null)
				.map((item) => ({ target: item.target, state: item.state, environment_blocked: item.environment_blocked, updated_at: item.updated_at })),
			leader: {
				last_wake_at: lastWake?.at ?? null,
				wakes_today: stats.leader_wakes_today ?? 0,
				last_proposal_items: Array.isArray((lastProposal?.payload as { items?: unknown } | null)?.items)
					? ((lastProposal!.payload as { items: unknown[] }).items.length)
					: 0,
			},
			watermarks,
			active_leases: snapshot.active_leases,
			// D3.5: the catalog role sessions still running, with what they run for.
			sessions: runningRoleSessions(stateDir).map((session) => ({
				target: session.target,
				role: session.role,
				base: session.base,
				started_at: session.started_at,
			})),
			// D4.6: where the owner is awaited, as pointers only — never the question.
			waiting: listWaitingStatus(stateDir),
			stats,
			updated_at: updatedAt,
			log_path: snapshot.log_path,
		};

		if (isJson) {
			return { stdout: jsonOutput(projection), stderr: "", returncode: 0 };
		}

		const text = `Loop Daemon Status:
  Daemon Running: ${snapshot.daemon_running ? `YES (PID: ${snapshot.pid})` : "NO"}
  Mode: ${mode}
  Paused: ${snapshot.paused ? `YES (${snapshot.pause_reason || "no reason"})` : "NO"}
  Active Leases: ${snapshot.active_leases_count}
  Running Sessions: ${projection.sessions.length === 0 ? "none" : projection.sessions.map((session) => `${session.role} (${session.base}) on ${session.target}`).join(", ")}
  Log: ${snapshot.log_path}
  Watermarks:
    Issues: ${watermarks.issues_updated_at || "none"}
    Comments: ${watermarks.comments_updated_at || "none"}
    PRs: ${watermarks.prs_updated_at || "none"}
  Stats:
    Total Ticks: ${stats.ticks_total}
    Total Events: ${stats.events_observed_total}
    Last Tick: ${stats.last_tick_at || "never"}
`;
		return { stdout: text, stderr: "", returncode: 0 };
	}

	if (command === "logs") {
		const isJson = args.includes("--json");
		const linesParsed = parsePositiveIntFlag(args, "--lines", 50, 5000);
		if (linesParsed.error) {
			return { stdout: "", stderr: linesParsed.error, returncode: 2 };
		}
		const logPath = join(stateDir, "daemon.log");
		const exists = existsSync(logPath);
		const lines = exists ? readLogTailLines(logPath, linesParsed.value) : [];
		if (isJson) {
			return {
				stdout: jsonOutput({ exists, log_path: logPath, lines }),
				stderr: "",
				returncode: 0,
			};
		}
		return {
			stdout: lines.length > 0 ? `${lines.join("\n")}\n` : "",
			stderr: "",
			returncode: 0,
		};
	}

	if (command === "start") {
		const isDryRun = args.includes("--dry-run");
		const isJson = args.includes("--json");
		const intervalParsed = parsePositiveIntFlag(
			args,
			"--interval",
			loopConfig.interval_seconds ?? 60,
		);
		if (intervalParsed.error) {
			return { stdout: "", stderr: intervalParsed.error, returncode: 2 };
		}
		const intervalSec = intervalParsed.value;
		const alive = options?.isProcessAlive ?? isPidAlive;
		const killFn = options?.killProcess ?? ((pid: number, sig: NodeJS.Signals | number) => process.kill(pid, sig));
		const logPath = join(stateDir, "daemon.log");

		const lockInspection = readDaemonLock(stateDir);
		if (lockInspection.exists && lockInspection.lock && alive(lockInspection.lock.pid)) {
			if (isJson) {
				return {
					stdout: jsonOutput({
						status: "already_running",
						daemon_running: true,
						pid: lockInspection.lock.pid,
						lock: lockInspection.lock,
						log_path: logPath,
					}),
					stderr: "",
					returncode: 0,
				};
			}
			return {
				stdout: `Loop daemon already running (PID: ${lockInspection.lock.pid})\n`,
				stderr: "",
				returncode: 0,
			};
		}

		const preflightError = await checkRunPreflight(isDryRun);
		if (preflightError) {
			return preflightError;
		}

		ensureLoopStateDir(stateDir);
		const spawner = options?.spawnDaemon ?? spawnDetachedDaemonProcess;
		let handle: SpawnDaemonHandle;
		try {
			handle = spawner({
				root: absoluteRoot,
				stateDir,
				intervalSec,
				dryRun: isDryRun,
				logPath,
			});
		} catch (error: any) {
			return {
				stdout: "",
				stderr: `Error: failed to spawn loop daemon: ${error?.message || String(error)}\n`,
				returncode: 1,
			};
		}

		const timeoutMs = options?.startupTimeoutMs ?? 10_000;
		const deadline = Date.now() + timeoutMs;
		while (true) {
			const current = readDaemonLock(stateDir);
			if (current.lock && current.lock.pid === handle.pid && alive(handle.pid)) {
				if (isJson) {
					return {
						stdout: jsonOutput({
							status: "started",
							daemon_running: true,
							pid: handle.pid,
							interval_seconds: intervalSec,
							dry_run: isDryRun,
							lock: current.lock,
							log_path: logPath,
						}),
						stderr: "",
						returncode: 0,
					};
				}
				return {
					stdout: `Loop daemon started (PID: ${handle.pid}, log: ${logPath})\n`,
					stderr: "",
					returncode: 0,
				};
			}

			if (handle.hasExited?.() || !alive(handle.pid)) {
				const tail = readLogTailLines(logPath, 20);
				return {
					stdout: "",
					stderr:
						"Error: loop daemon exited before acquiring lock" +
						(tail.length > 0 ? `:\n${tail.join("\n")}` : "") +
						"\n",
					returncode: 1,
				};
			}

			if (Date.now() >= deadline) {
				try {
					killFn(handle.pid, "SIGTERM");
				} catch {}
				return {
					stdout: "",
					stderr: "Error: timed out waiting for loop daemon to acquire lock\n",
					returncode: 1,
				};
			}

			await new Promise((res) => setTimeout(res, 25));
		}
	}

	if (command === "stop") {
		const isJson = args.includes("--json");
		const force = args.includes("--force");
		const timeoutParsed = parsePositiveIntFlag(args, "--timeout", 10);
		if (timeoutParsed.error) {
			return { stdout: "", stderr: timeoutParsed.error, returncode: 2 };
		}
		const timeoutMs = args.some((a) => a === "--timeout" || a.startsWith("--timeout="))
			? timeoutParsed.value * 1000
			: (options?.stopTimeoutMs ?? 10_000);
		const alive = options?.isProcessAlive ?? isPidAlive;
		const killFn = options?.killProcess ?? ((pid: number, sig: NodeJS.Signals | number) => process.kill(pid, sig));

		const sendSignal = (pid: number, signal: NodeJS.Signals): boolean => {
			try {
				killFn(pid, signal);
				return true;
			} catch (error: any) {
				if (error?.code === "ESRCH") {
					return false;
				}
				throw error;
			}
		};

		const lockInspection = readDaemonLock(stateDir);
		if (!lockInspection.exists) {
			if (isJson) {
				return {
					stdout: jsonOutput({
						status: "already_stopped",
						daemon_running: false,
						pid: null,
						stale_lock_cleaned: false,
					}),
					stderr: "",
					returncode: 0,
				};
			}
			return { stdout: "Loop daemon is not running\n", stderr: "", returncode: 0 };
		}

		if (!lockInspection.lock || !alive(lockInspection.lock.pid)) {
			const cleaned = cleanStaleDaemonLock(stateDir, lockInspection.lock?.host_token);
			const deadPid = lockInspection.lock?.pid ?? null;
			if (isJson) {
				return {
					stdout: jsonOutput({
						status: "already_stopped",
						daemon_running: false,
						pid: deadPid,
						stale_lock_cleaned: cleaned,
					}),
					stderr: "",
					returncode: 0,
				};
			}
			return {
				stdout: cleaned
					? "Loop daemon is not running (cleaned stale lock)\n"
					: "Loop daemon is not running\n",
				stderr: "",
				returncode: 0,
			};
		}

		const pid = lockInspection.lock.pid;
		const token = lockInspection.lock.host_token;
		try {
			const sent = sendSignal(pid, "SIGTERM");
			if (!sent) {
				cleanStaleDaemonLock(stateDir, token);
				if (isJson) {
					return {
						stdout: jsonOutput({ status: "stopped", daemon_running: false, pid }),
						stderr: "",
						returncode: 0,
					};
				}
				return { stdout: `Loop daemon stopped (PID: ${pid})\n`, stderr: "", returncode: 0 };
			}
		} catch (error: any) {
			return {
				stdout: "",
				stderr: `Error: failed to signal loop daemon (PID ${pid}): ${error?.message || String(error)}\n`,
				returncode: 1,
			};
		}

		const waitUntilDead = async (ms: number): Promise<boolean> => {
			const deadline = Date.now() + ms;
			while (alive(pid)) {
				if (Date.now() >= deadline) return false;
				await new Promise((res) => setTimeout(res, 25));
			}
			return true;
		};

		if (await waitUntilDead(timeoutMs)) {
			cleanStaleDaemonLock(stateDir, token);
			if (isJson) {
				return {
					stdout: jsonOutput({ status: "stopped", daemon_running: false, pid }),
					stderr: "",
					returncode: 0,
				};
			}
			return { stdout: `Loop daemon stopped (PID: ${pid})\n`, stderr: "", returncode: 0 };
		}

		if (force) {
			try {
				sendSignal(pid, "SIGKILL");
			} catch (error: any) {
				return {
					stdout: "",
					stderr: `Error: failed to SIGKILL loop daemon (PID ${pid}): ${error?.message || String(error)}\n`,
					returncode: 1,
				};
			}
			if (await waitUntilDead(1000)) {
				cleanStaleDaemonLock(stateDir, token);
				if (isJson) {
					return {
						stdout: jsonOutput({ status: "killed", daemon_running: false, pid }),
						stderr: "",
						returncode: 0,
					};
				}
				return { stdout: `Loop daemon killed (PID: ${pid})\n`, stderr: "", returncode: 0 };
			}
		}

		return {
			stdout: "",
			stderr: force
				? `Error: loop daemon (PID ${pid}) did not exit after SIGKILL\n`
				: `Error: timed out waiting for loop daemon (PID ${pid}) to stop; pass --force to SIGKILL\n`,
			returncode: 1,
		};
	}

	if (command === "pause") {
		let state = loadLoopState(stateDir);
		if (!state) state = initLoopState();

		const reasonIdx = args.indexOf("--reason");
		const reason = reasonIdx >= 0 && args[reasonIdx + 1] ? args[reasonIdx + 1] : "manual pause";

		state.paused = true;
		state.pause_reason = reason;
		state.updated_at = new Date().toISOString();
		saveLoopState(stateDir, state);

		return {
			stdout: `Loop daemon paused: ${reason}\n`,
			stderr: "",
			returncode: 0,
		};
	}

	if (command === "resume") {
		let state = loadLoopState(stateDir);
		if (!state) state = initLoopState();

		state.paused = false;
		state.pause_reason = null;
		state.updated_at = new Date().toISOString();
		saveLoopState(stateDir, state);

		return {
			stdout: "Loop daemon resumed\n",
			stderr: "",
			returncode: 0,
		};
	}

	if (command === "retire-lease") {
		const targetId = args[0];
		if (!targetId) {
			return {
				stdout: "",
				stderr: "Error: target-id is required for retire-lease\n",
				returncode: 2,
			};
		}

		let state = loadLoopState(stateDir);
		if (state && state.active_leases[targetId]) {
			delete state.active_leases[targetId];
			state.updated_at = new Date().toISOString();
			saveLoopState(stateDir, state);
		}
		deleteLease(stateDir, targetId);

		return {
			stdout: `Retired lease for ${targetId}\n`,
			stderr: "",
			returncode: 0,
		};
	}

	if (command === "rebuild") {
		const isJson = args.includes("--json");
		const rebuild = await rebuildLoopState(absoluteRoot, {
			gh: options?.gh,
			stateDir,
			fixtureSnapshot: options?.snapshotOverride,
		});

		if (isJson) {
			return {
				stdout: jsonOutput({
					rebuilt: true,
					watermarks: rebuild.state.watermarks,
					active_leases: rebuild.reconstructedLeases,
					leases_count: rebuild.reconstructedLeases.length,
				}),
				stderr: "",
				returncode: 0,
			};
		}

		return {
			stdout: `Reconstructed loop state: ${rebuild.reconstructedLeases.length} active leases restored\n`,
			stderr: "",
			returncode: 0,
		};
	}

	if (command === "tick" || command === "run") {
		if (command === "run") {
			const intervalCheck = parsePositiveIntFlag(
				args,
				"--interval",
				loopConfig.interval_seconds ?? 60,
			);
			if (intervalCheck.error) {
				return { stdout: "", stderr: intervalCheck.error, returncode: 2 };
			}
		}
		const isDryRun = args.includes("--dry-run");
		const preflightError = await checkRunPreflight(isDryRun);
		if (preflightError) {
			return preflightError;
		}
	}

	if (command === "tick") {
		const isDryRun = args.includes("--dry-run");
		const isJson = args.includes("--json");
		const lockHeld = Boolean(options?.lockHeld);

		let releaseLock: (() => void) | null = null;
		let onSig: () => void = () => {};
		if (!isDryRun && !lockHeld) {
			const lockResult = acquireDaemonLock(stateDir);
			if (!lockResult.acquired) {
				return {
					stdout: "",
					stderr: `Error: concurrent tick rejected: ${lockResult.reason}\n`,
					returncode: 1,
				};
			}
			releaseLock = lockResult.release;
		}

		try {
			let state = loadLoopState(stateDir);
			if (!state) {
				if (isDryRun) {
					state = initLoopState();
				} else {
					const runsDir = join(absoluteRoot, ".imm/runs");
					const hasRuns = existsSync(runsDir);
					if (hasRuns) {
						const rebuilt = await rebuildLoopState(absoluteRoot, {
							gh: options?.gh,
							stateDir,
							fixtureSnapshot: options?.snapshotOverride,
						});
						state = rebuilt.state;
					} else {
						state = initLoopState();
					}
				}
			}

			let obs: import("./observer.ts").ObservationResult;
			try {
				obs = await observeGithub(absoluteRoot, {
					gh: options?.gh,
					previousState: state,
					snapshotOverride: options?.snapshotOverride,
				});
			} catch (error: any) {
				return {
					stdout: "",
					stderr: `Error: observation failed: ${error?.message || String(error)}\n`,
					returncode: 1,
				};
			}

			if (!isDryRun) {
				// Every per-day counter rolls together, the leader wake count included.
				rollDailyStats(state, new Date().toISOString().slice(0, 10));

				state.watermarks = obs.watermarks;
				state.updated_at = new Date().toISOString();
				state.stats.ticks_total += 1;
				state.stats.ticks_today = (state.stats.ticks_today ?? 0) + 1;
				state.stats.events_observed_total += obs.events.length;
				state.stats.last_tick_at = new Date().toISOString();

				saveLoopState(stateDir, state);

				for (const evt of obs.events) {
					appendLoopEvent(stateDir, evt);
				}
			}

			const recordedAt = new Date().toISOString();
			// D6: a background job that reached a terminal outcome releases its lease and
			// becomes E12 `job_finished` / E13 `lane_settled` on this tick. A dead pid
			// with no outcome is `lost`, which the judgement retries once then escalates.
			if (!isDryRun) {
				reconcileLoopJobs(stateDir, { now: recordedAt });
				obs.events.push(...loopJobEvents(stateDir, { now: recordedAt }));
			}

			const gh = options?.gh ?? createGhTransport();
			let daemonLogin: string | null = options?.guardFacts?.daemon_identity ?? null;
			if (!isDryRun && !daemonLogin) {
				daemonLogin = await readAuthenticatedGithubLogin(gh, absoluteRoot);
			}

			const currentBudget: ScheduleBudget = {
				ticks_today: state.stats.ticks_today ?? 0,
				dispatches_today: state.stats.dispatches_today ?? 0,
				max_ticks_per_day: loopConfig.budget.max_ticks_per_day,
				max_dispatches_per_day: loopConfig.budget.max_dispatches_per_day,
			};

			const closedIssues = new Set(
				obs.snapshot.issues.filter((i) => i.state === "closed").map((i) => i.number),
			);
			const unresolved_blockers: Record<number, number[]> = {};
			for (const issue of obs.snapshot.issues) {
				const blockers = (issue.blocked_by ?? []).filter((b) => !closedIssues.has(b));
				if (blockers.length > 0) {
					unresolved_blockers[issue.number] = blockers;
				}
			}

			const expected_record_revisions: Record<string, string> = {};
			for (const dec of obs.snapshot.lane_decisions ?? []) {
				if (dec.record_revision) {
					if (dec.run_id) expected_record_revisions[dec.run_id] = dec.record_revision;
					if (dec.task_id) expected_record_revisions[dec.task_id] = dec.record_revision;
					const m = dec.task_id?.match(/(?:issue|task)-(\d+)/);
					if (m) {
						expected_record_revisions[m[1]] = dec.record_revision;
						expected_record_revisions[`issue-${m[1]}`] = dec.record_revision;
					}
				}
			}

			for (const event of obs.events) {
				if (event.kind === "E7_LANE_DECISION_REPLIED" || event.kind === "E6_LANE_DECISION_NEEDED") {
					const issueNum = "issue_number" in event ? event.issue_number : undefined;
					const taskId =
						("task_id" in event && event.task_id)
							? event.task_id
							: ("run_id" in event && event.run_id)
								? event.run_id
								: (issueNum ? `issue-${issueNum}` : "");
					if (taskId && !expected_record_revisions[taskId]) {
						const target = findLaneRelayTarget(absoluteRoot, taskId);
						if (target) {
							try {
								const raw = readTaskRecordRaw(target.lane_path, taskId);
								if (raw.record && raw.revision) {
									expected_record_revisions[taskId] = raw.revision;
									if ("run_id" in event && event.run_id) expected_record_revisions[event.run_id] = raw.revision;
									if (issueNum) {
										expected_record_revisions[String(issueNum)] = raw.revision;
										expected_record_revisions[`issue-${issueNum}`] = raw.revision;
									}
								}
							} catch {}
						}
						try {
							const rootRaw = readTaskRecordRaw(absoluteRoot, taskId);
							if (rootRaw.record && rootRaw.revision) {
								expected_record_revisions[taskId] = rootRaw.revision;
								if ("run_id" in event && event.run_id) expected_record_revisions[event.run_id] = rootRaw.revision;
								if (issueNum) {
									expected_record_revisions[String(issueNum)] = rootRaw.revision;
									expected_record_revisions[`issue-${issueNum}`] = rootRaw.revision;
								}
							}
						} catch {}
					}
				}
			}

			let tickShutdown =
				options?.shutdownRequested ??
				options?.guardFacts?.shutdown_requested ??
				Boolean(options?.isShutdownRequested?.());
			onSig = () => {
				tickShutdown = true;
			};
			process.on("SIGINT", onSig);
			process.on("SIGTERM", onSig);

			const isShutdown = () =>
				tickShutdown ||
				Boolean(options?.isShutdownRequested?.()) ||
				Boolean(options?.guardFacts?.shutdown_requested);

			const duplicate_candidates_by_issue: Record<
				number,
				{ number: number; title: string; body: string; score?: number }
			> = {};
			for (const event of obs.events) {
				if (event.kind === "E1_NEW_ISSUE" || event.kind === "E2_ISSUE_EDITED") {
					const best = selectBestDuplicateCandidate(
						{ number: event.issue_number, title: event.title, body: event.body },
						obs.snapshot.issues,
					);
					if (best) {
						duplicate_candidates_by_issue[event.issue_number] = best;
					}
				}
			}

			const facts: GuardFacts = {
				paused: state.paused,
				active_leases: state.active_leases,
				identity_posture: detectIdentityPosture(inspectDaemonIdentity(absoluteRoot)),
				allowed_actors: loopConfig.allowed_actors,
				allowed_associations: loopConfig.allowed_associations,
				daemon_identity: daemonLogin,
				budget_exhausted: Boolean(budgetExhausted(currentBudget)),
				retry_counts: loadRepairRetries(stateDir),
				unresolved_blockers,
				duplicate_candidates_by_issue,
				pending_clarify: pendingClarifyInteractions(stateDir),
				expected_plan_digests: {
					...loadPublishedPlanDigests(stateDir),
					...(options?.guardFacts?.expected_plan_digests ?? {}),
				},
				expected_record_revisions: {
					...expected_record_revisions,
					...(options?.guardFacts?.expected_record_revisions ?? {}),
				},
				expected_record_revision: options?.guardFacts?.expected_record_revision ?? null,
				...options?.guardFacts,
				get shutdown_requested() {
					return isShutdown();
				},
				set shutdown_requested(val: boolean | undefined) {
					tickShutdown = Boolean(val);
				},
			};

			const classify =
				options?.classify ??
				createDecisionModelClassifier(absoluteRoot, {
					userConfigPath: options?.userConfigPath,
				});
			const enabledPoints =
				options?.enabledPoints ??
				(resolved.decision_models?.bindings
					? Object.keys(POINT_REGISTRY).filter((point) => resolved.decision_models.bindings[point]?.value !== "off")
					: undefined);
			const budgetTracker: JudgingBudgetTracker = {
				canInvoke: () => {
					const max = loopConfig.budget.max_dispatches_per_day;
					return max === null || (state.stats.dispatches_today ?? 0) < max;
				},
				recordInvocation: () => {
					if (!isDryRun) {
						rollDailyStats(state, recordedAt.slice(0, 10));
						state.stats.dispatches_today = (state.stats.dispatches_today ?? 0) + 1;
						state.stats.dispatches_total = (state.stats.dispatches_total ?? 0) + 1;
						state.updated_at = recordedAt;
						saveLoopState(stateDir, state);
					} else {
						state.stats.dispatches_today = (state.stats.dispatches_today ?? 0) + 1;
					}
				},
			};

			// S5/D5: the rebuildable work-item store is restored before scheduling, and a
			// level event is judged only when its fact fingerprint changed.
			let discardedBatches: DiscardTickEntry[] = [];
			if (!isDryRun) {
				ensureWorkItems(absoluteRoot, stateDir, obs.snapshot, loadPublishedPlanDigests(stateDir), recordedAt);
				// D5.2: a natively confirmed steer request lands before this tick judges,
				// dispatches and briefs, so the gate sees it once and the file is removed.
				applySteeringRequests(stateDir, recordedAt);
				// ULS D4.2: an abandoned item's batch is discarded until its record is terminal.
				discardedBatches = await discardAbandonedBatches({
					root: absoluteRoot,
					stateDir,
					now: recordedAt,
					host: laneExecutorHost(resolved.agents?.roles?.executor?.host),
					...(options?.createPort ? { createPort: options.createPort } : {}),
				});
			}
			const judged: JudgedEventSelection = isDryRun
				? { events: obs.events, pending: [] }
				: selectUnjudgedEvents(obs.events, stateDir);

			const judgements = await judgeEvents(judged.events, {
				facts,
				classify,
				enabledPoints,
				budgetTracker,
			});
			const decisions = judged.events.map((event, index) =>
				buildDecisionRecord(event, judgements[index], eventTarget(event), { recorded_at: recordedAt, dry_run: isDryRun }),
			);
			// Spec loop-agent-scheduling D8 with the `local` channel: no GitHub comment
			// resumes a clarify question, the answer the user confirmed locally does.
			const localClarify =
				loopConfig.interaction?.channel === "local"
					? localClarifyAnswerDecisions(stateDir, facts.pending_clarify ?? {}, {
							recorded_at: recordedAt,
							dry_run: isDryRun,
						})
					: [];

			if (!isDryRun) {
				for (const decision of [...decisions, ...localClarify]) {
					appendLoopDecision(stateDir, decision);
				}
				recordJudgedEvents(judged, stateDir, recordedAt);
				for (let index = 0; index < judged.events.length; index += 1) {
					const event = judged.events[index]!;
					const issueNumber = "issue_number" in event ? event.issue_number : undefined;
					recordWorkItemOutcome(stateDir, {
						event,
						handler: decisions[index]!.handler,
						plan_digest:
							issueNumber === undefined ? null : (facts.expected_plan_digests?.[issueNumber] ?? null),
						now: recordedAt,
					});
				}
			}

			const gitHubPort = options?.gitHubPort ?? createLoopGitHubPort(gh, absoluteRoot);
			// Spec loop-agent-scheduling D4: with the `local` channel, an answer the
			// user confirmed in their own Host session is applied here, through the
			// same verifier and relay a GitHub reply uses. It reaches the Lane on
			// this tick, so the next tick starts its generation.
			const localAnswers =
				isDryRun || loopConfig.interaction?.channel !== "local"
					? []
					: await applyLocalLaneDecisionAnswers({
							stateDir,
							guardFacts: facts,
							recordRevision: (taskId) => localDecisionRecordRevision(absoluteRoot, taskId),
							relayInputFactory: (taskId) =>
								options?.relayInputFactory ??
								(options?.laneRuntime
									? createDefaultRelayInputFactory(absoluteRoot, taskId, { laneRuntime: options.laneRuntime, stateDir })
									: undefined),
							...(options?.relayDecision ? { relayDecision: options.relayDecision } : {}),
						});

			const dispatchRes = await dispatchDecisions({
				root: absoluteRoot,
				stateDir,
				loopConfig,
				events: judged.events,
				decisions: [...decisions, ...localClarify],
				snapshot: obs.snapshot,
				state,
				gitHubPort,
				guardFacts: facts,
				dryRun: isDryRun,
				now: recordedAt,
				agentPort: options?.agentPort,
				standingDaemon: options?.standingDaemon === true,
				relayDecision: options?.relayDecision,
				relayInputFactory: options?.relayInputFactory,
				laneRuntime: options?.laneRuntime,
			});

			// S2/D2: the briefing is compiled on every tick; only a fingerprint the journal
			// has not recorded starts one read-only leader session. `S2` executes nothing.
			rollDailyStats(state, recordedAt.slice(0, 10));
			const leaderLimits = loopSessionLimits({ agents: resolved.agents, loop: resolved.loop }, "leader");
			const leaderTick = await runLeaderTick({
				root: absoluteRoot,
				stateDir,
				roles: resolved.loop.value.roles,
				mode: loopConfig.mode,
				dry_run: isDryRun,
				now: recordedAt,
				turn_budget: leaderLimits.turn_budget,
				timeout_ms: leaderLimits.timeout_ms,
				budget: {
					wakes_today: state.stats.leader_wakes_today ?? 0,
					max_leader_wakes_per_day: loopConfig.budget.max_leader_wakes_per_day ?? LOOP_LEADER_WAKES_BOUNDS.default,
					dispatches_today: state.stats.dispatches_today ?? 0,
					max_dispatches_per_day: loopConfig.budget.max_dispatches_per_day,
				},
				sessionProvider: options?.leader?.provider ?? null,
			});
			if (leaderTick.counted_wake && !isDryRun) {
				recordLeaderWake(state.stats);
				state.updated_at = recordedAt;
				saveLoopState(stateDir, state);
			}

			// S3/D3.1: an accepted proposal item executes only behind its own code guard.
			// A record still running belongs to a dead tick: every dispatch awaits
			// its session inside the same tick, so reaping first frees the role
			// for this tick's items instead of refusing them forever.
			if (!isDryRun) reapOrphanedRoleSessions(stateDir, { at: recordedAt });
			const leaderItems =
				leaderTick.items.length === 0
					? []
					: await applyLeaderProposal(leaderTick.items, {
							root: absoluteRoot,
							stateDir,
							now: recordedAt,
							dry_run: isDryRun,
							fingerprint: leaderTick.briefing_fingerprint,
							roles: resolved.loop.value.roles,
							guardFacts: facts,
							events: obs.events,
							candidates: reconcileCandidates(stateDir),
							max_concurrent: loopConfig.max_concurrent,
							dispatches_today: state.stats.dispatches_today ?? 0,
							max_dispatches_per_day: loopConfig.budget.max_dispatches_per_day,
							runNext: async ({ decision, event }) =>
								(
									await dispatchDecisions({
										root: absoluteRoot,
										stateDir,
										loopConfig,
										events: [event],
										decisions: [decision],
										snapshot: obs.snapshot,
										state,
										gitHubPort,
										guardFacts: facts,
										dryRun: isDryRun,
										now: recordedAt,
										agentPort: options?.agentPort,
										standingDaemon: options?.standingDaemon === true,
										...(options?.relayDecision ? { relayDecision: options.relayDecision } : {}),
										...(options?.relayInputFactory ? { relayInputFactory: options.relayInputFactory } : {}),
										...(options?.laneRuntime ? { laneRuntime: options.laneRuntime } : {}),
									})
								).dispatches,
							planInitiative: (input) =>
								options?.leader?.planInitiative
									? options.leader.planInitiative(input)
									: Promise.resolve(null),
							runKernel:
								options?.leader?.runKernel ??
								((input) => ({ exit_code: 1, json: { reason: `kernel_unavailable: ${input.argv.join(" ")}` } })),
							startSession:
								options?.leader?.provider === undefined
									? async () => ({ completed: false, reason: "session_provider_unavailable" })
									: createRoleSessionRunner({
											provider: options.leader.provider,
											root: absoluteRoot,
											stateDir,
											snapshot: obs.snapshot,
										}),
							// D4.2: the target's authority gates, from local requests and the Kernel projection.
							resolveFacts: async ({ target, work_item }) => {
								const subject = resolveSubject(target);
								const taskIds = [...new Set([...work_item.binding.task_ids, ...(subject.task_id ? [subject.task_id] : [])])];
								let owned: ReturnType<typeof batchStateForTarget> | undefined;
								const ownedBatch = () =>
									(owned ??= batchStateForTarget(absoluteRoot, {
										task_ids: taskIds,
										initiative_slug: work_item.binding.initiative_slug ?? null,
									}));
								return collectResolveFacts({
									stateDir,
									target,
									subject,
									task_ids: taskIds,
									project: async (taskId) => {
										try {
											const projected = await projectAssurance(absoluteRoot, taskId);
											if (projected.error !== null) return null;
											return {
												risk: projected.projection.risk,
												open_user_decision_count: projected.projection.open_user_decision_count,
												unresolved_user_decision_ids: [...projected.projection.unresolved_user_decision_ids],
												replan_required_ids: [...projected.projection.replan_required_ids],
												authorization: { state: projected.projection.authorization.state },
												next_obligation: projected.projection.next_obligation,
											};
										} catch {
											return null;
										}
									},
									// ULS D5.4: an ambiguous or unreadable batch throws, and the leader dispatch refuses the item as unresolved.
									batchState: () => ownedBatch()?.batch_state ?? null,
									noProgressChildren: () => ownedBatch()?.no_progress_children ?? [],
									heldChildren: () => readBatchSummaries(absoluteRoot, taskIds).blocked_children.map((child) => child.task_id),
									comments: obs.snapshot.issues.flatMap((issue) => issue.comments ?? []),
								});
							},
							// D4.2 / ULS D5.1: a parked batch leaves `needs_human` only through a fresh Batch
							// Authorization and a stalled Executor only through a fresh drive entry, so `resume`
							// applies to an item with no batch blocker.
							checkBatchResumable: ({ work_item }) => {
								const subject = resolveSubject(work_item.target);
								let batch: ReturnType<typeof batchStateForTarget>;
								try {
									batch = batchStateForTarget(absoluteRoot, {
										task_ids: [...new Set([...work_item.binding.task_ids, ...(subject.task_id ? [subject.task_id] : [])])],
										initiative_slug: work_item.binding.initiative_slug ?? null,
									});
								} catch (error) {
									return { resumed: false, reason: error instanceof Error ? error.message : String(error) };
								}
								if (!batch) return { resumed: true, reason: "no batch blocks the item" };
								if (batch.batch_state === "needs_human")
									return { resumed: false, reason: "the parked batch needs a fresh Batch Authorization" };
								if (batch.no_progress_children.length > 0)
									return { resumed: false, reason: `lane_executor_no_progress: ${batch.no_progress_children.join(", ")} needs a fresh drive entry` };
								if (batch.batch_state !== "running" && batch.batch_state !== "pending")
									return { resumed: false, reason: `batch_${batch.batch_state}` };
								return { resumed: true, reason: `batch ${batch.batch_id} is ${batch.batch_state}` };
							},
							// D4.5: ask on the subject; a pending literal_user request is annotated, never withdrawn.
							askOwner: async ({ target, subject, context, pending_literal_user, pending_lane_entry_blocked }) => {
								const channel =
									loopConfig.interaction?.channel === "local"
										? createLocalInteractionChannel({ stateDir })
										: createGithubInteractionChannel({
												port: gitHubPort,
												comments: () => obs.snapshot.issues.flatMap((issue) => issue.comments ?? []),
												binding: () => ({}),
												guardFacts: facts,
												// D4.6: a withdrawn request is no longer a waiting pointer.
												onRetired: (interactionId) => clearWaitingPointer(stateDir, interactionId),
											});
								return askOwnerQuestion(
									{ stateDir, now: recordedAt, target, channel, pending_literal_user, ...(pending_lane_entry_blocked ? { pending_lane_entry_blocked } : {}) },
									{ subject, context },
								);
							},
						});

			// D3.5: a leader dispatch starts a real catalog session, so started
			// sessions count against the daily dispatch budget exactly like a
			// Tier-1/2 dispatch: later ticks and the scheduler see them. A failed
			// session ran too, so only refusals that started nothing are spared.
			// D3.5: every started catalog session counts, whatever item kind started
			// it (`dispatch` or a `resolve{kind:"replan"}`), accepted or failed.
			const leaderStartedSessions = isDryRun ? 0 : leaderItems.filter((item) => item.session_started === true).length;
			if (leaderStartedSessions > 0) {
				rollDailyStats(state, recordedAt.slice(0, 10));
				state.stats.dispatches_today = (state.stats.dispatches_today ?? 0) + leaderStartedSessions;
				state.stats.dispatches_total = (state.stats.dispatches_total ?? 0) + leaderStartedSessions;
				state.updated_at = recordedAt;
				saveLoopState(stateDir, state);
			}

			const outputPayload = {
				contract: "assurance_kernel/loop_tick_result/v1",
				dry_run: isDryRun,
				events: obs.events,
				events_count: obs.events.length,
				decisions,
				decisions_count: decisions.length,
				dispatches: dispatchRes.dispatches,
				dispatches_count: dispatchRes.dispatches.length,
				local_answers: localAnswers,
				local_answers_count: localAnswers.length,
				discarded_batches: discardedBatches,
				leader: leaderTick,
				leader_items: leaderItems,
				leader_items_count: leaderItems.length,
				watermarks: obs.watermarks,
				paused: state.paused,
			};

			if (isJson) {
				return { stdout: jsonOutput(outputPayload), stderr: "", returncode: 0 };
			}

			const summary =
				`Tick completed (${isDryRun ? "DRY-RUN" : "LIVE"}): observed ${obs.events.length} events, recorded ${decisions.length} decisions, dispatched ${dispatchRes.dispatches.length}\n` +
				obs.events.map((e) => `  [${e.kind}] ${e.event_id}`).join("\n") +
				(obs.events.length > 0 ? "\n" : "") +
				decisions.map((d) => `  -> ${d.handler} (tier ${d.tier}) ${d.event_id}: ${d.reason}`).join("\n") +
				(decisions.length > 0 ? "\n" : "") +
				dispatchRes.dispatches.map((d) => `  => dispatch: ${d.handler} [${d.outcome}] ${d.detail}`).join("\n") +
				(dispatchRes.dispatches.length > 0 ? "\n" : "") +
				discardedBatches
					.map((d) => `  => discard: ${d.target} batch ${d.batch_id} ${d.batch_state}${d.retained.map((r) => `\n     ${r.reason}`).join("")}`)
					.join("\n") +
				(discardedBatches.length > 0 ? "\n" : "") +
				`  => leader: ${leaderTick.woke ? "woke" : "idle"} (${leaderTick.reason}) fingerprint ${leaderTick.briefing_fingerprint}` +
				(leaderItems.length === 0
					? ""
					: `\n${leaderItems.map((item) => `  => leader item ${item.action} ${item.target} [${item.outcome}] ${item.reason}`).join("\n")}`) +
				(leaderTick.proposal === null ? "" : `, ${leaderTick.proposal.items} item(s), ${leaderTick.proposal.rejected.length} rejected`) +
				"\n";

			return { stdout: summary, stderr: "", returncode: 0 };
		} finally {
			process.off("SIGINT", onSig);
			process.off("SIGTERM", onSig);
			if (releaseLock) {
				releaseLock();
			}
		}
	}

	if (command === "reconcile") {
		const isDryRun = args.includes("--dry-run");
		const isJson = args.includes("--json");

		let releaseLock: (() => void) | null = null;
		if (!isDryRun && !options?.lockHeld) {
			const lockResult = acquireDaemonLock(stateDir);
			if (!lockResult.acquired) {
				return {
					stdout: "",
					stderr: `Error: ${lockResult.reason}\n`,
					returncode: 1,
				};
			}
			releaseLock = lockResult.release;
		}

		try {
			const state = loadLoopState(stateDir) ?? initLoopState();
			const now = options?.now?.() ?? new Date().toISOString();
			const result = await reconcileSkippedDecisions({
				stateDir,
				dryRun: isDryRun,
				now,
				state,
			});

			const payload = {
				contract: "assurance_kernel/loop_reconcile_result/v1",
				dry_run: isDryRun,
				...result,
			};
			if (isJson) {
				return { stdout: jsonOutput(payload), stderr: "", returncode: 0 };
			}
			const summary = `Reconcile completed (${isDryRun ? "DRY-RUN" : "LIVE"}): checked ${result.checked}, candidates ${result.candidates.length}\n` +
				result.candidates.map((candidate) => `  => candidate ${candidate.target} (${candidate.point ?? "needs_judging"}${candidate.choice === null ? "" : `: ${candidate.choice}`})`).join("\n") +
				(result.candidates.length > 0 ? "\n" : "");
			return { stdout: summary, stderr: "", returncode: 0 };
		} finally {
			if (releaseLock) releaseLock();
		}
	}

	if (command === "run") {
		const isDryRun = args.includes("--dry-run");
		const intervalParsed = parsePositiveIntFlag(
			args,
			"--interval",
			loopConfig.interval_seconds ?? 60,
		);
		if (intervalParsed.error) {
			return { stdout: "", stderr: intervalParsed.error, returncode: 2 };
		}
		const intervalSec = intervalParsed.value;

		const lockResult = acquireDaemonLock(stateDir);
		if (!lockResult.acquired) {
			return {
				stdout: "",
				stderr: `Error: failed to start standing daemon: ${lockResult.reason}\n`,
				returncode: 1,
			};
		}

		let running = true;
		let shutdownRequested = Boolean(options?.shutdownRequested || options?.isShutdownRequested?.());
		let sleepTimer: ReturnType<typeof setTimeout> | null = null;
		let wakeSleep: (() => void) | null = null;
		const stop = (): void => {
			running = false;
			shutdownRequested = true;
			if (sleepTimer) {
				clearTimeout(sleepTimer);
				sleepTimer = null;
			}
			if (wakeSleep) {
				const wake = wakeSleep;
				wakeSleep = null;
				wake();
			}
		};
		const onHup = (): void => {};

		process.on("SIGINT", stop);
		process.on("SIGTERM", stop);
		process.on("SIGHUP", onHup);

		const checkShutdown = (): boolean =>
			shutdownRequested ||
			!running ||
			Boolean(options?.shutdownRequested) ||
			Boolean(options?.isShutdownRequested?.());

		let reconciledOnStart = false;

		try {
			while (running) {
				const isShut = checkShutdown();
				const nowIso = options?.now?.() ?? new Date().toISOString();
				lockResult.heartbeat(nowIso);
				if (!isShut && (!reconciledOnStart || shouldRunScheduledReconcile(stateDir, nowIso))) {
					reconciledOnStart = true;
					const recRes = await runLoopDaemonCli(
						["reconcile", ...(isDryRun ? ["--dry-run"] : [])],
						absoluteRoot,
						{
							...options,
							stateDir,
							lockHeld: true,
							standingDaemon: true,
						},
					);
					if (recRes.stdout) process.stdout.write(recRes.stdout);
					if (recRes.stderr) process.stderr.write(recRes.stderr);
				}

				const tickRes = await runLoopDaemonCli(
					["tick", ...(isDryRun ? ["--dry-run"] : [])],
					absoluteRoot,
					{
						...options,
						stateDir,
						lockHeld: true,
						standingDaemon: true,
						shutdownRequested: isShut,
						isShutdownRequested: checkShutdown,
					},
				);
				if (tickRes.stdout) process.stdout.write(tickRes.stdout);
				if (tickRes.stderr) process.stderr.write(tickRes.stderr);

				if (options?.sleep) {
					await options.sleep(intervalSec);
				}

				if (options?.singleIteration || !running || isShut || checkShutdown()) {
					break;
				}
				lockResult.heartbeat(options?.now?.() ?? new Date().toISOString());
				if (!options?.sleep) {
					await new Promise<void>((res) => {
						if (checkShutdown()) {
							res();
							return;
						}
						wakeSleep = res;
						sleepTimer = setTimeout(() => {
							sleepTimer = null;
							if (wakeSleep === res) wakeSleep = null;
							res();
						}, intervalSec * 1000);
					});
				}
			}
		} finally {
			if (sleepTimer) {
				clearTimeout(sleepTimer);
				sleepTimer = null;
			}
			wakeSleep = null;
			process.off("SIGINT", stop);
			process.off("SIGTERM", stop);
			process.off("SIGHUP", onHup);
			lockResult.release();
		}

		return { stdout: "Loop daemon stopped\n", stderr: "", returncode: 0 };
	}

	return {
		stdout: "",
		stderr: `Unknown command: ${command}\nUse imm-loop --help for usage.\n`,
		returncode: 2,
	};
}

/**
 * The `imm-loop` executable, entered through `v4_runtime.ts cli imm-loop`. It
 * composes the decision-model seam; a library caller injects its own `classify`,
 * and an absent one leaves Tier 2 at its deterministic baseline. It wires no
 * Lane-root Host runtime: host-neutral code never imports a Host adapter, so a
 * verified Lane decision reply fails closed until an adapter injects one.
 */
export async function runLoopDaemonExecutable(
	argv: string[],
	root: string = process.cwd(),
): Promise<{ stdout: string; stderr: string; returncode: number }> {
	const parsedState = parseStateDirArg(argv);
	const command = parsedState.error ? undefined : parsedState.args[0];
	const effectiveStateDir = parsedState.stateDirArg
		? resolve(root, parsedState.stateDirArg)
		: join(root, ".imm/state/loop");
	// The agent port belongs to the live daemon: a `tick`, `run`, or `reconcile`
	// from this executable dispatches agent-backed handlers through real sessions.
	const needsAgent = command === "tick" || command === "run" || command === "reconcile";
	const handlerDeps = needsAgent ? createDefaultAgentHandlerDeps(root, { stateDir: effectiveStateDir }) : undefined;
	const agentPort = handlerDeps ? createAgentHandlerPort(handlerDeps) : undefined;
	const leader = handlerDeps
		? (() => {
				const planLimits = loopSessionLimits(resolveConfig(root), "plan");
				return {
					provider: handlerDeps.sessionProvider,
					planInitiative: createInitiativePlanner({
						provider: handlerDeps.sessionProvider,
						turn_budget: planLimits.turn_budget,
						timeout_ms: planLimits.timeout_ms,
					}),
					runKernel: handlerDeps.runKernel,
				};
			})()
		: undefined;
	return runLoopDaemonCli(argv, root, {
		classify: createDecisionModelClassifier(root),
		...(agentPort ? { agentPort } : {}),
		...(leader ? { leader } : {}),
	});
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
	const result = await runLoopDaemonExecutable(process.argv.slice(2), process.cwd());
	if (result.stdout) process.stdout.write(result.stdout);
	if (result.stderr) process.stderr.write(result.stderr);
	process.exit(result.returncode);
}
