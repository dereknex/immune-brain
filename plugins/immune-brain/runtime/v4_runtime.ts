/**
 * Immune-Brain v4-only shipped CLI runtime.
 *
 * This module is the SINGLE shipped CLI entrypoint after v4 storage
 * retirement. It exposes:
 *   - `imm-kernel` intent author/validate (host-neutral TaskIntent drafts)
 *   - `imm-kernel status --json` (read-only v3 legacy shadow status)
 *   - `imm-kernel inspect --json` (read-only Inspect Projection)
 *   - `imm-kernel audit --legacy` (explicit read-only legacy audit)
 *   - `imm-plan --routing-status --json` (strict Git-owned route projection)
 *   - `imm-plan <plan-path> [--json]` (read-only Plan validation)
 *   - `imm-tracker` (opt-in, one-way, non-authoritative GitHub Issue projection)
 *
 * Every retired v3 mutating command (`imm-work`, `imm-review`, `imm-migrate`,
 * `imm-finish`, `imm-autowork`, `imm-heal`, `imm-check-child-output`,
 * `imm-retire-stale-wrapper`) and its `bin/` wrapper is fully removed: the name
 * falls through to the generic unknown-command response instead of a
 * per-command diagnostic. Only the retired *option* wall on `imm-plan` remains.
 *
 * v3 State Ledger mutations, migrations, authority receipts, automatic
 * observations, and TaskRecord v1 writers are NOT reachable from any shipped
 * entrypoint. The legacy runtime module remains for
 * test fixtures and historical parsing only and is never imported by any shipped entrypoint.
 */
import { fileURLToPath } from "node:url";
import process from "node:process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runKernelCommand } from "./commands/kernel";
import { resolveConfig } from "./config/layered_config.ts";
import {
	inspectRoutingPolicy,
	type RoutingPolicyProjection,
} from "./managed_task_routing_policy";
import {
	PlanValidationError,
	projectPlanValidation,
} from "./plan_core";
import { runGithubTrackerCli } from "./github_issue_tracker";

// The retired *option* wall on imm-plan: the command stays available for
// read-only validation, while its v3 mutating options keep this rejection.
const RETIRED_PLAN_OPTIONS = new Set([
	"--sync",
	"--terminate-current",
	"--approve-successor",
	"--expected-current-plan",
	"--expected-ledger-revision",
	"--user-confirmed",
	"--status",
	"--reason",
	"--reason-code",
	"--stage",
	"--invalidated-assumption",
	"--avoidable",
]);

function hasRetiredPlanOption(args: string[]): boolean {
	return args.some((arg) => RETIRED_PLAN_OPTIONS.has(arg.split("=", 1)[0]));
}

function jsonOutput(payload: unknown): string {
	return `${JSON.stringify(payload, null, 2)}\n`;
}

function unavailableRoutingProjection(): RoutingPolicyProjection {
	return {
		policy_status: "invalid",
		route: null,
		v3_new_plan_sync: "allowed",
		legacy_v3_mode: null,
		terminal_import: null,
		worktree_sha256: null,
		index_sha256: null,
		ownership: "unavailable",
		reason_code: "policy_read_unavailable",
	};
}

// The read-only v3 option wall: retired plan options keep this exact
// rejection, so the message shape is deliberately not a parameter of the
// caller's option name or arguments.
function retiredPlanOptionResponse(root: string): {
	stdout: string;
	stderr: string;
	returncode: number;
} {
	// A nonterminal v3 owner requires the operator to drain or terminate it
	// using the prior runtime before any v4 write.
	let requiresDrain = false;
	try {
		const statePath = resolve(root, ".imm/memory/current_iteration.json");
		const raw = JSON.parse(readFileSync(statePath, "utf8")) as {
			runtime_status?: unknown;
			plan_terminal?: unknown;
		};
		requiresDrain =
			raw &&
			(typeof raw.runtime_status === "string"
				? raw.runtime_status !== "idle"
				: false) &&
			raw.plan_terminal === null;
	} catch {
		requiresDrain = false;
	}
	const code = requiresDrain ? "drain_required" : "v3_storage_retired";
	const hint = requiresDrain
		? "drain or terminate the active v3 Plan using the prior runtime before upgrading"
		: "v3 State Ledger mutations are retired; author a host-neutral TaskIntent and enroll it through the Pi TUI";
	return {
		stdout: "",
		stderr: `Immune-Brain v3 mutation rejected (${code}): ${hint}\n`,
		returncode: 1,
	};
}

function runPlanCli(args: string[], root: string): {
	stdout: string;
	stderr: string;
	returncode: number;
} {
	if (hasRetiredPlanOption(args)) return retiredPlanOptionResponse(root);
	if (
		args.length === 2 &&
		args[0] === "--routing-status" &&
		args[1] === "--json"
	) {
		let projection: RoutingPolicyProjection;
		try {
			projection = inspectRoutingPolicy(root);
		} catch {
			projection = unavailableRoutingProjection();
		}
		return { stdout: jsonOutput(projection), stderr: "", returncode: 0 };
	}
	const planPath = args[0];
	const json = args.length === 2 && args[1] === "--json";
	if (
		!planPath ||
		planPath.startsWith("-") ||
		(args.length !== 1 && !json)
	) {
		return {
			stdout: "",
			stderr:
				"invalid_plan_command: use imm-plan --routing-status --json or imm-plan <plan-path> [--json]\n",
			returncode: 2,
		};
	}
	try {
		const projection = projectPlanValidation(planPath, root);
		if (json) {
			return { stdout: jsonOutput(projection), stderr: "", returncode: 0 };
		}
		return {
			stdout: `Plan validation passed.\nSummary: ${projection.summary}\nSteps: ${projection.steps.length}\n`,
			stderr: "",
			returncode: 0,
		};
	} catch (error) {
		const message =
			error instanceof PlanValidationError ? error.message : "unexpected failure";
		return {
			stdout: "",
			stderr: `plan_validation_rejected: ${message.slice(0, 4096)}\n`,
			returncode: 1,
		};
	}
}

async function runKernelCli(args: string[], root: string): Promise<{
	stdout: string;
	stderr: string;
	returncode: number;
}> {
	// Only the retained kernel surface is reachable: intent author/validate,
	// status --json, and the explicit audit command. All other kernel
	// subcommands (readiness, journal, migrate) are retired.
	const sub = args[0] ?? "";
	// The canonical author shape is discoverable before any error probing: a
	// caller who does not know the destination/stdin contract reads it here
	// instead of discovering it through a failed call.
	if (sub === "intent" && (args[1] === "--help" || args[1] === "help" || args[1] === undefined))
		return {
			stdout: `${intentAuthorHelp()}\n`,
			stderr: "",
			returncode: 0,
		};
	// The explicit claimless storage-layout migration is reachable here: a
	// worktree still on the retired file store has no other entry point, and
	// every mutating subcommand stays fail-closed behind it.
	if (sub === "config" && args.includes("--json") && args.slice(1).every((arg) => arg === "--json")) {
		const config = resolveConfig(root);
		return { stdout: `${JSON.stringify(config, null, 2)}\n`, stderr: "", returncode: config.diagnostics.some((d) => d.severity === "error") ? 1 : 0 };
	}
	if (sub === "config" && args[1] === "migrate") {
		if (!args.slice(2).every((arg) => arg === "--write"))
			return { stdout: "", stderr: "usage: imm-kernel config migrate [--write]\n", returncode: 2 };
		const { migrateConfig } = await import("./config/migrate");
		try {
			const report = migrateConfig(root, { write: args.includes("--write") });
			return { stdout: `${JSON.stringify(report, null, 2)}\n`, stderr: report.written ? "" : "dry run: review the after objects, then rerun with --write\n", returncode: 0 };
		} catch (error) {
			return { stdout: "", stderr: `config migrate: ${(error as Error).message}\n`, returncode: 1 };
		}
	}
	if (sub === "migrate") return runKernelCommand(args, root);
	if (sub === "intent") return runKernelCommand(args, root);
	if (sub === "status" && args.includes("--json")) return runKernelCommand(args, root);
	if (sub === "inspect" && args.includes("--json")) return runKernelCommand(args, root);
	if (sub === "audit") {
		// Explicit read-only legacy audit: bounded, no symlink, deterministic
		// redacted projection. Never writes journal or workflow state.
		const { projectLegacyAudit } = await import("./kernel/legacy_audit");
		try {
			const projection = projectLegacyAudit(root);
			return {
				stdout: `${JSON.stringify(projection, null, 2)}\n`,
				stderr: "",
				returncode: 0,
			};
		} catch (error) {
			return {
				stdout: "",
				stderr: `legacy_audit_rejected: ${error instanceof Error ? error.message : String(error)}\n`,
				returncode: 1,
			};
		}
	}
	return {
		stdout: "",
		stderr: "invalid_kernel_command: imm-kernel supports intent author|validate, migrate --storage-layout, status --json, inspect --json, and audit --legacy only\n",
		returncode: 2,
	};
}

async function runCli(command: string, args: string[], root: string): Promise<{
	stdout: string;
	stderr: string;
	returncode: number;
}> {
	if (command === "imm-kernel") return runKernelCli(args, root);
	if (command === "imm-plan") return runPlanCli(args, root);
	if (command === "imm-tracker") return runGithubTrackerCli(args, root);
	if (command === "imm-session") {
		const verb = args[0];
		const batchIdx = args.indexOf("--batch");
		if (batchIdx !== -1) {
			if (verb === "send" || verb === "stop") {
				return {
					stdout: "",
					stderr: `invalid_session_command: imm-session ${verb} --batch is not supported; Host tools own Lane sessions\n`,
					returncode: 2,
				};
			}
			if (verb === "await") {
				const batchId = args[batchIdx + 1];
				if (!batchId || batchId.startsWith("--")) {
					return { stdout: "", stderr: "invalid_session_command: imm-session await --batch <batch_id> needs a batch id\n", returncode: 2 };
				}
				let timeoutMs: number | undefined;
				const timeoutIdx = args.indexOf("--timeout-ms");
				if (timeoutIdx !== -1) {
					const raw = args[timeoutIdx + 1];
					if (!raw || !/^\d+$/.test(raw)) {
						return { stdout: "", stderr: "invalid_session_command: --timeout-ms must be a whole number of milliseconds\n", returncode: 2 };
					}
					timeoutMs = Number(raw);
				}
				const { observeLanes } = await import("./lane_sessions/index");
				const { resolveConfig } = await import("./config/layered_config");
				const { projectAssurance } = await import("./kernel/assurance_projection");
				// Pass the configured list through: `herdr` is admitted only inside
				// Herdr, so outside Herdr this refuses with every reason and opens
				// no session. Fall back only to the layered-config default.
				let providers: string[] = ["herdr"];
				try {
					const resolved = resolveConfig(root).session_providers as unknown as { value?: unknown };
					const value = (resolved as { value?: unknown }).value;
					if (Array.isArray(value)) providers = value as string[];
				} catch { /* keep the default; observe opens no session either way */ }
				const kernel = {
					projectTask: async (laneRoot: string, taskId: string) => projectAssurance(laneRoot, taskId),
				} as never;
				const result = await observeLanes(root, batchId, {
					kernel,
					env: process.env as Record<string, string | undefined>,
					host: "pi",
					providers,
				} as never, { wait: true, ...(timeoutMs !== undefined ? { timeoutMs } : {}) });
				if (!result.ok) return { stdout: `${JSON.stringify(result)}\n`, stderr: "", returncode: 1 };
				return { stdout: `${JSON.stringify(result)}\n`, stderr: "", returncode: 0 };
			}
		}
		const { runSessionCli } = await import("./session/cli");
		return runSessionCli(args, process.env);
	}
	return {
		stdout: "",
		stderr: `Unknown Immune-Brain v4 command: ${command}\n`,
		returncode: 2,
	};
}

/**
 * The canonical TaskIntent author contract, printed by `imm-kernel intent` and
 * `imm-kernel intent --help`. It states destination, stdin, and the strict v2
 * descriptor shape before a caller has to discover them by failing a call.
 */
export function intentAuthorHelp(): string {
	return [
		"imm-kernel intent author <destination> --stdin --json",
		"  destination: docs/plans/<task-id>.intent.json (created exclusively; never overwritten)",
		"  stdin:       the complete candidate TaskIntent JSON on file descriptor 0",
		"  stdout:      { valid, enrollment_ready, intent_ref, git_base_initialization_required, ... }",
		"",
		"imm-kernel intent validate <path> --json",
		"",
		"Candidate shape (assurance_kernel/task_intent/v1):",
		JSON.stringify(
			{
				contract: "assurance_kernel/task_intent/v1",
				task_id: "<task-id>",
				owner: "user",
				goal: "<one closable outcome>",
				risk: "routine|material|critical",
				revision: 1,
				scope_hint: ["<every file the slice touches>"],
				acceptance: [
					{
						id: "<ID>",
						assertion: "<observable invariant>",
						verification: JSON.stringify({
							contract: "assurance_kernel/verification_descriptor/v2",
							command: { executable: "bun", argv: ["test", "tests/<focused>.test.ts"], cwd: ".", timeout_ms: 180000, max_output_bytes: 196608 },
							environment: { prepare: null, writable_paths: [] },
						}),
					},
				],
			},
			null,
			2,
		),
		"",
		"Unknown fields are rejected; the descriptor parser is strict v2 and never infers a runner.",
		"A v1 descriptor is historical-only and needs an explicit Intent revision before execution.",
	].join("\n");
}

async function main(argv: string[]): Promise<number> {
	const mode = argv[0];
	const root = process.cwd();
	if (mode === "list-commands") {
		process.stdout.write(
			`${JSON.stringify(
				{
					commands: [
						{
							name: "imm-kernel",
							description:
								"v4-only Kernel surface: intent author/validate, status, inspect, and explicit legacy audit.",
							json_output: true,
							examples: [
								"imm-kernel intent author docs/plans/<task-id>.intent.json --stdin --json",
								"imm-kernel intent validate docs/plans/<task-id>.intent.json --json",
								"imm-kernel status --json",
								"imm-kernel inspect --json",
								"imm-kernel audit --legacy",
							],
						},
						{
							name: "imm-plan",
							description:
								"Read-only routing-policy projection and explicit Plan validation. v3 Plan mutation is retired.",
							json_output: true,
							examples: [
								"imm-plan --routing-status --json",
								"imm-plan docs/plans/<plan>.md --json",
							],
						},
						{
							name: "imm-tracker",
							description:
								"Opt-in, one-way GitHub Issue projection. Publishes one complete Parent/Child graph and execution recommendation. Never grants or consumes Kernel authority.",
							json_output: true,
							examples: [
								"imm-tracker publish-initiative --stdin --json",
							],
						},
						{
							name: "imm-session",
							description:
								"The Parent's Supervised Session Port surface: create, instruct, await, observe, read, stop and reconcile one Lane Executor session through an explicitly named provider. Never Kernel authority or progress evidence.",
							json_output: true,
							examples: [
								"imm-session probe --provider herdr",
								"imm-session create --provider herdr --cwd <lane_path> --label <name> --host claude-code --entry \"<drive entry> <task_id>\" -- <host arguments>",
								"imm-session await <handle> --provider herdr",
							],
						},
					],
				},
				null,
				2,
			)}\n`,
		);
		return 0;
	}
	if (mode === "cli") {
		const command = argv[1];
		const completed = await runCli(command, argv.slice(2), root);
		if (completed.stdout) process.stdout.write(completed.stdout);
		if (completed.stderr) process.stderr.write(completed.stderr);
		return completed.returncode;
	}
	process.stderr.write(
		`Usage: v4_runtime.ts <list-commands|cli <command> [args...]>\n`,
	);
	return 2;
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
	const code = await main(process.argv.slice(2));
	process.exit(code);
}

export { main, runCli, runKernelCli, runGithubTrackerCli };
