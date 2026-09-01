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
 *   - a stable `drain_required` / `v3_storage_retired` wall for every v3
 *     mutating command (work/review/migrate/finish/autowork/heal/...).
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
import {
	inspectRoutingPolicy,
	type RoutingPolicyProjection,
} from "./managed_task_routing_policy";
import {
	PlanValidationError,
	projectPlanValidation,
} from "./plan_core";
import { runGithubTrackerCli } from "./github_issue_tracker";

// Retired v3 mutating command wall. Read-only v3 commands that only project
// state (imm-plan validate) stay available; every writer is retired.
const RETIRED_MUTATING_COMMANDS = new Set([
	"imm-work",
	"imm-review",
	"imm-migrate",
	"imm-finish",
	"imm-autowork",
	"imm-heal",
	"imm-check-child-output",
	"imm-retire-stale-wrapper",
]);

const READ_ONLY_V3_COMMANDS = new Set(["imm-plan"]);

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

function retiredResponse(command: string, args: string[], root: string): {
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
	if (hasRetiredPlanOption(args)) return retiredResponse("imm-plan", args, root);
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
		stderr: "invalid_kernel_command: imm-kernel supports intent author|validate, status --json, inspect --json, and audit --legacy only\n",
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
	if (RETIRED_MUTATING_COMMANDS.has(command)) return retiredResponse(command, args, root);
	return {
		stdout: "",
		stderr: `Unknown Immune-Brain v4 command: ${command}\n`,
		returncode: 2,
	};
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
								"Opt-in, one-way GitHub Issue projection. Creates a Parent once, never rewrites or closes it. Never grants or consumes Kernel authority.",
							json_output: true,
							examples: [
								"imm-tracker create-initiative --stdin --json",
								"imm-tracker upsert-task --initiative-id <id> --slice-id <id> --intent docs/plans/<task-id>.intent.json --json",
							],
						},
					],
					retired: [...RETIRED_MUTATING_COMMANDS].sort(),
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

export { main, runCli, runKernelCli, runGithubTrackerCli, RETIRED_MUTATING_COMMANDS };
