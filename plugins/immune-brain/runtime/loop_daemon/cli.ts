/**
 * Loop Daemon: CLI Surface (S1)
 *
 * Implements S1 and D2 of docs/specs/loop-daemon.spec.md.
 * Exposes:
 *   - imm-loop tick [--dry-run] [--json]
 *   - imm-loop status [--json]
 *   - imm-loop pause [--reason <text>]
 *   - imm-loop resume
 *   - imm-loop retire-lease <target-id>
 *   - imm-loop rebuild [--json]
 *   - imm-loop run [--interval <sec>] [--dry-run]
 */

import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { DEFAULT_LOOP_CONFIG, type LoopConfig, resolveConfig } from "../config/layered_config.ts";
import { createGhTransport, type GhTransport } from "../github_issue_tracker.ts";
import { readTaskRecordRaw } from "../kernel/storage.ts";
import { readNoTouch } from "../no_touch.ts";
import { findLaneRelayTarget, type relayLaneDecision } from "../unattended/lane_decision.ts";
import { buildDecisionRecord } from "./decision_record.ts";
import { dispatchDecisions, type RelayInputFactory } from "./dispatch.ts";
import { createLoopGitHubPort, type LoopGitHubPort } from "./github_port.ts";
import { type GuardFacts, eventTarget } from "./guards.ts";
import { detectIdentityPosture, inspectDaemonIdentity, readAuthenticatedGithubLogin } from "./identity.ts";
import { type ClassifyFn, createDecisionModelClassifier, judgeEvents } from "./judgement.ts";
import { acquireDaemonLock, readDaemonLock } from "./lock.ts";
import { observeGithub } from "./observer.ts";
import { rebuildLoopState } from "./rebuild.ts";
import { loadRepairRetries } from "./repair_agent.ts";
import { budgetExhausted, type ScheduleBudget } from "./scheduler.ts";
import {
	appendLoopDecision,
	appendLoopEvent,
	deleteLease,
	initLoopState,
	listLeases,
	loadLoopState,
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
		/** Facts the caller owns (budget, leases, identity posture, retry cap). */
		guardFacts?: Partial<GuardFacts>;
		loopConfig?: LoopConfig;
		userConfigPath?: string;
		isShutdownRequested?: () => boolean;
		shutdownRequested?: boolean;
		sleep?: (seconds: number) => Promise<void> | void;
		relayDecision?: typeof relayLaneDecision;
		relayInputFactory?: RelayInputFactory<unknown>;
	},
): Promise<CliOutput> {
	const absoluteRoot = resolve(root);
	const stateDir = options?.stateDir ?? join(absoluteRoot, ".imm/state/loop");

	const command = argv[0];
	const args = argv.slice(1);

	if (!command || command === "--help" || command === "-h" || command === "help") {
		const usage = `Usage: imm-loop <command> [options]

Commands:
  tick [--dry-run] [--json]       Run a single observation and event normalization tick
  status [--json]                 Show loop daemon status, lock, watermarks, and active leases
  pause [--reason <text>]         Pause the daemon from scheduling new work
  resume                          Resume scheduling for the daemon
  retire-lease <target-id>        Manually retire/remove an active lease
  rebuild [--json]                Reconstruct state and leases from GitHub and repository evidence
  run [--interval <sec>]          Run standing loop daemon process

Options:
  --dry-run                       Do not mutate state, lock, or repository
  --json                          Output structured JSON
`;
		return { stdout: usage, stderr: "", returncode: command ? 0 : 2 };
	}

	const resolved = resolveConfig(absoluteRoot, { userConfigPath: options?.userConfigPath });
	const loopConfig: LoopConfig =
		options?.loopConfig ??
		(resolved.loop?.valid ? (resolved.loop.value as LoopConfig) : null) ??
		DEFAULT_LOOP_CONFIG;

	if (command === "status") {
		const isJson = args.includes("--json");
		const lockInspection = readDaemonLock(stateDir);
		let state = loadLoopState(stateDir);
		const leases = listLeases(stateDir);

		if (!state && existsSync(join(stateDir, "state.json"))) {
			return {
				stdout: "",
				stderr: "Error: .imm/state/loop/state.json is corrupt or unreadable\n",
				returncode: 1,
			};
		}

		if (!state) {
			state = initLoopState();
		}

		const projection = {
			daemon_running: lockInspection.isLive,
			lock: lockInspection.lock,
			paused: state.paused,
			pause_reason: state.pause_reason,
			watermarks: state.watermarks,
			active_leases: leases,
			stats: state.stats,
			updated_at: state.updated_at,
		};

		if (isJson) {
			return { stdout: jsonOutput(projection), stderr: "", returncode: 0 };
		}

		const text = `Loop Daemon Status:
  Daemon Running: ${lockInspection.isLive ? `YES (PID: ${lockInspection.lock?.pid})` : "NO"}
  Paused: ${state.paused ? `YES (${state.pause_reason || "no reason"})` : "NO"}
  Active Leases: ${leases.length}
  Watermarks:
    Issues: ${state.watermarks.issues_updated_at || "none"}
    Comments: ${state.watermarks.comments_updated_at || "none"}
    PRs: ${state.watermarks.prs_updated_at || "none"}
  Stats:
    Total Ticks: ${state.stats.ticks_total}
    Total Events: ${state.stats.events_observed_total}
    Last Tick: ${state.stats.last_tick_at || "never"}
`;
		return { stdout: text, stderr: "", returncode: 0 };
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
		const isDryRun = args.includes("--dry-run");

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
			const daemonLogin = options?.guardFacts?.daemon_identity ?? (await readAuthenticatedGithubLogin(gh, absoluteRoot));
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
				const today = new Date().toISOString().slice(0, 10);
				if (state.stats.today_date !== today) {
					state.stats.today_date = today;
					state.stats.ticks_today = 0;
					state.stats.dispatches_today = 0;
				}

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
			let declaredNoTouch: string[];
			try {
				declaredNoTouch = readNoTouch(absoluteRoot);
			} catch (error: any) {
				return {
					stdout: "",
					stderr: `Error: unreadable no-touch declaration: ${error?.message || String(error)}\n`,
					returncode: 1,
				};
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

			const facts: GuardFacts = {
				paused: state.paused,
				no_touch_paths: declaredNoTouch,
				active_leases: state.active_leases,
				identity_posture: detectIdentityPosture(inspectDaemonIdentity(absoluteRoot)),
				allowed_actors: loopConfig.allowed_actors,
				allowed_associations: loopConfig.allowed_associations,
				daemon_identity: daemonLogin,
				budget_exhausted: Boolean(budgetExhausted(currentBudget)),
				retry_counts: loadRepairRetries(stateDir),
				unresolved_blockers,
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

			const judgements = await judgeEvents(obs.events, { facts, classify: options?.classify });
			const decisions = obs.events.map((event, index) =>
				buildDecisionRecord(event, judgements[index], eventTarget(event), { recorded_at: recordedAt, dry_run: isDryRun }),
			);

			if (!isDryRun) {
				for (const decision of decisions) {
					appendLoopDecision(stateDir, decision);
				}
			}

			const gitHubPort = options?.gitHubPort ?? createLoopGitHubPort(gh, absoluteRoot);
			const dispatchRes = await dispatchDecisions({
				root: absoluteRoot,
				stateDir,
				loopConfig,
				events: obs.events,
				decisions,
				snapshot: obs.snapshot,
				state,
				gitHubPort,
				guardFacts: facts,
				dryRun: isDryRun,
				now: recordedAt,
				relayDecision: options?.relayDecision,
				relayInputFactory: options?.relayInputFactory,
			});

			const outputPayload = {
				contract: "assurance_kernel/loop_tick_result/v1",
				dry_run: isDryRun,
				events: obs.events,
				events_count: obs.events.length,
				decisions,
				decisions_count: decisions.length,
				dispatches: dispatchRes.dispatches,
				dispatches_count: dispatchRes.dispatches.length,
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
				(dispatchRes.dispatches.length > 0 ? "\n" : "");

			return { stdout: summary, stderr: "", returncode: 0 };
		} finally {
			process.off("SIGINT", onSig);
			process.off("SIGTERM", onSig);
			if (releaseLock) {
				releaseLock();
			}
		}
	}

	if (command === "run") {
		const isDryRun = args.includes("--dry-run");
		const intervalIdx = args.indexOf("--interval");
		const intervalSec =
			intervalIdx >= 0 && args[intervalIdx + 1]
				? Math.max(1, parseInt(args[intervalIdx + 1], 10))
				: (loopConfig.interval_seconds ?? 60);

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
		const stop = (): void => {
			running = false;
			shutdownRequested = true;
			lockResult.release();
		};

		process.on("SIGINT", stop);
		process.on("SIGTERM", stop);

		const checkShutdown = (): boolean =>
			shutdownRequested ||
			!running ||
			Boolean(options?.shutdownRequested) ||
			Boolean(options?.isShutdownRequested?.());

		try {
			while (running) {
				const isShut = checkShutdown();
				const tickRes = await runLoopDaemonCli(
					["tick", ...(isDryRun ? ["--dry-run"] : [])],
					absoluteRoot,
					{
						...options,
						lockHeld: true,
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
				if (!options?.sleep) {
					await new Promise((res) => setTimeout(res, intervalSec * 1000));
				}
			}
		} finally {
			process.off("SIGINT", stop);
			process.off("SIGTERM", stop);
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

// The executable composes the decision-model seam; a library caller injects its
// own `classify`, and an absent one leaves Tier 2 at its deterministic baseline.
if (fileURLToPath(import.meta.url) === process.argv[1]) {
	const root = process.cwd();
	const result = await runLoopDaemonCli(process.argv.slice(2), root, {
		classify: createDecisionModelClassifier(root),
	});
	if (result.stdout) process.stdout.write(result.stdout);
	if (result.stderr) process.stderr.write(result.stderr);
	process.exit(result.returncode);
}
