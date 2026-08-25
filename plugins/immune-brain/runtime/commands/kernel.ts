import { createHash } from "node:crypto";
import {
	closeSync,
	constants as fsConstants,
	lstatSync,
	openSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { stableStringify } from "../canonical_json";
import {
	KernelStoreSecurityError,
	appendJournalEntry,
	mapLegacyState,
	readSecureProjectFile,
	type JournalEntry,
	type JournalReasonCode,
	type LegacyMapping,
	type TaskPhase,
} from "../kernel";
import {
	INTENT_MAX_BYTES,
	canonicalIntentHash,
	parseTaskIntentV1,
} from "../kernel/intent";
import {
	canonicalDescriptorBytes,
	parseVerificationDescriptor,
} from "../verification_descriptor";
import { inspectRoutingPolicy } from "../managed_task_routing_policy"
import { inspectLegacyAggregate } from "../kernel/legacy";
import { projectLegacyAudit } from "../kernel/legacy_audit";

export interface KernelCommandResult {
	stdout: string;
	stderr: string;
	returncode: number;
}

interface KernelExecution {
	result: KernelCommandResult;
	journal: Omit<JournalEntry, "contract" | "timestamp">;
}

const SOURCE_PATH = ".imm/memory/current_iteration.json";

function jsonResult(payload: unknown, returncode = 0): KernelCommandResult {
	return {
		stdout: `${JSON.stringify(payload, null, 2)}\n`,
		stderr: "",
		returncode,
	};
}

function errorResult(code: string, message: string, returncode: number): KernelCommandResult {
	return jsonResult({ error: { code, message } }, returncode);
}

function asRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

function readLegacyState(root: string): Record<string, unknown> {
	let parsed: unknown;
	try {
		const content = readSecureProjectFile(root, SOURCE_PATH);
		if (Buffer.byteLength(content, "utf8") > 2 * 1024 * 1024)
			throw new KernelStoreSecurityError("v3 Ledger exceeds the shadow read limit");
		parsed = JSON.parse(content);
	} catch (error) {
		if (error instanceof KernelStoreSecurityError) throw error;
		if (error instanceof SyntaxError)
			throw new KernelStoreSecurityError("v3 Ledger is not valid JSON");
		throw error;
	}
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
		throw new KernelStoreSecurityError("v3 Ledger root must be an object");
	const state = parsed as Record<string, unknown>;
	if (Object.keys(asRecord(state.steps)).length > 1024)
		throw new KernelStoreSecurityError("v3 Ledger exceeds the step limit");
	return state;
}

function legacyTaskId(state: Record<string, unknown>): string {
	const identity = [state.plan_path, state.plan_signature]
		.map((value) => (typeof value === "string" ? value : ""))
		.join("\0");
	return `legacy-${createHash("sha256").update(identity).digest("hex").slice(0, 16)}`;
}

function detectDivergence(state: Record<string, unknown>): {
	detected: boolean;
	fields: string[];
} {
	const aggregate = inspectLegacyAggregate(state);
	const fields: string[] = [];
	if (aggregate.replan_mismatch || aggregate.replan_type_invalid)
		fields.push("requires_replan");
	if (aggregate.active_step_mismatch) fields.push("active_step");
	if (aggregate.ownership_conflict) fields.push("ownership");
	if (aggregate.follow_up_malformed || aggregate.follow_up_state === "closed")
		fields.push("pending_follow_up");
	if (aggregate.steps_malformed) fields.push("steps");
	if (["invalid", "conflict"].includes(aggregate.terminal))
		fields.push("plan_terminal");

	const nextAction = asRecord(state.next_action);
	if (
		aggregate.replan_signal &&
		(nextAction.action === "activate" ||
			(typeof nextAction.command === "string" &&
				nextAction.command.includes("imm-work activate")))
	)
		fields.push("next_action");
	return { detected: fields.length > 0, fields };
}

function journalFor(
	command: string,
	phase: TaskPhase | null,
	result: JournalEntry["result"],
	reasonCode: JournalReasonCode,
	taskId: string | null,
	recoveryHint: string | null,
	userIntervention = false,
): Omit<JournalEntry, "contract" | "timestamp"> {
	return {
		task_id: taskId,
		command,
		entry_phase: phase,
		result,
		reason_code: reasonCode,
		recovery_hint: recoveryHint,
		planner_reentry: false,
		user_intervention: userIntervention,
	};
}

function sourceFailure(command: string, error: unknown): KernelExecution {
	const message = error instanceof Error ? error.message : String(error);
	const code: JournalReasonCode = message.startsWith("source_missing:")
		? "source_missing"
		: error instanceof KernelStoreSecurityError
			? "source_invalid"
			: "source_read_failed";
	return {
		result: errorResult(code, message, 1),
		journal: journalFor(
			command,
			null,
			"rejected",
			code,
			null,
			"Repair or restore the v3 State Ledger before retrying.",
		),
	};
}

function runStatus(root: string): KernelExecution {
	try {
		const state = readLegacyState(root);
		const shadow = mapLegacyState(state);
		const divergence = detectDivergence(state);
		const taskId = legacyTaskId(state);
		return {
			result: jsonResult({
				contract: "assurance_kernel/shadow_status/v1",
				source: SOURCE_PATH,
				v3: {
					schema_version: state.schema_version ?? null,
					plan_path: state.plan_path ?? null,
					runtime_status: state.runtime_status ?? null,
					requires_replan: state.requires_replan === true,
					active_step: state.active_step ?? null,
				},
				shadow,
				divergence,
			}),
			journal: journalFor(
				"status",
				shadow.phase,
				divergence.detected ? "escalated" : "ok",
				divergence.detected ? "shadow_divergence" : "command_ok",
				taskId,
				divergence.detected
					? "Inspect the reported v3 authority fields; shadow never repairs them."
					: null,
			),
		};
	} catch (error) {
		return sourceFailure("status", error);
	}
}

export interface MigrationDryRunReport {
	contract: "assurance_kernel/migration_report/v1";
	dry_run: true;
	writes_performed: false;
	source: typeof SOURCE_PATH;
	ambiguous: boolean;
	records: Array<{
		legacy_plan_path: string | null;
		candidate_task_id: string;
		mapping: LegacyMapping;
	}>;
}

export function buildMigrationDryRunReport(root: string): MigrationDryRunReport {
	const state = readLegacyState(root);
	const mapping = mapLegacyState(state);
	return {
		contract: "assurance_kernel/migration_report/v1",
		dry_run: true,
		writes_performed: false,
		source: SOURCE_PATH,
		ambiguous: mapping.ambiguous,
		records: [{
			legacy_plan_path: typeof state.plan_path === "string" ? state.plan_path : null,
			candidate_task_id: legacyTaskId(state),
			mapping,
		}],
	};
}

export function migrationDryRunDigest(report: MigrationDryRunReport): string {
	return `sha256:${createHash("sha256").update(`assurance_kernel/migration_report/v1\0${stableStringify(report)}`).digest("hex")}`;
}

const INTENT_SIDECAR_PREFIX = "docs/plans/";
const TASK_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

function intentSidecarPath(taskId: string): string {
	if (!TASK_ID_PATTERN.test(taskId))
		throw new Error("task id must match [A-Za-z0-9][A-Za-z0-9._-]{0,127}");
	return `${INTENT_SIDECAR_PREFIX}${taskId}.intent.json`;
}

/**
 * Bounded synchronous stdin read, used ONLY by the exact
 * `intent author <path> --stdin` branch. Help, validation, and all pre-existing
 * imm-kernel commands never read file descriptor 0.
 */
function readBoundedStdin(maxBytes: number): string {
	const bytes = readFileSync(0);
	if (bytes.byteLength > maxBytes)
		throw new Error(`candidate exceeds the ${maxBytes} byte TaskIntent bound`);
	return bytes.toString("utf8");
}

function intentActiveOwner(root: string): { kernel: boolean; v3: boolean } {
	let kernelOwner = false;
	let v3Owner = false;
	try {
		const state = JSON.parse(
			readSecureProjectFile(root, ".imm/memory/current_iteration.json"),
		) as Record<string, unknown>;
		if (typeof state.runtime_status === "string" && state.runtime_status !== "idle")
			v3Owner = true;
	} catch {
		// No readable v3 Ledger means no v3 owner.
	}
	const backend = join(
		resolve(root),
		".imm",
		"kernel",
		"backend_claim.json",
	);
	try {
		const raw = JSON.parse(readFileSync(backend, "utf8")) as Record<string, unknown>;
		const status = raw.lifecycle_status;
		kernelOwner =
			typeof status === "string" &&
			(status === "active" || status === "draining" || status === "probing" || status === "executing");
	} catch {
		kernelOwner = false;
	}
	return { kernel: kernelOwner, v3: v3Owner };
}

/**
 * Canonical `imm-kernel intent author <path> --stdin --json`.
 * Host-neutral TaskIntent draft creation: strict parsing, verification
 * descriptor canonicalization, and exclusive no-overwrite creation of exactly
 * one untracked draft. Never stages Git, enrolls, writes workflow state or
 * journal, creates parents, or overwrites.
 */
function runIntentAuthor(args: string[], root: string): KernelExecution {
	const nonFlags = args.filter((arg) => !arg.startsWith("-"));
	if (nonFlags.length !== 1)
		return {
			result: errorResult(
				"invalid_command",
				"imm-kernel intent author requires exactly one destination path",
				2,
			),
			journal: journalFor(
				"intent",
				null,
				"rejected",
				"invalid_command",
				null,
				"Run imm-kernel intent author <path> --stdin --json.",
			),
		};
	if (!args.includes("--stdin"))
		return {
			result: errorResult(
				"stdin_required",
				"imm-kernel intent author requires --stdin for the bounded candidate input",
				2,
			),
			journal: journalFor(
				"intent",
				null,
				"rejected",
				"invalid_command",
				null,
				"Run imm-kernel intent author <path> --stdin --json.",
			),
		};
	const unsupported = args.filter(
		(arg) => arg.startsWith("-") && !["--stdin", "--json"].includes(arg),
	);
	if (unsupported.length > 0)
		return {
			result: errorResult("invalid_command", `unsupported intent author option: ${unsupported[0]}`, 2),
			journal: journalFor(
				"intent",
				null,
				"rejected",
				"invalid_command",
				null,
				"Run imm-kernel intent author <path> --stdin --json.",
			),
		};
	const pathArg = nonFlags[0];
	// Routing policy must resolve to the active kernel_task_intent route.
	const policy = inspectRoutingPolicy(root);
	if (policy.policy_status === "invalid") {
		return {
			result: errorResult(
				"routing_policy_invalid",
				`routing policy is present but cannot be trusted (${policy.reason_code}); new managed authority is blocked`,
				1,
			),
			journal: journalFor(
				"intent",
				null,
				"rejected",
				"routing_policy_invalid",
				null,
				"Repair or remove the policy file; authoring requires the active kernel_task_intent route.",
			),
		};
	}
	if (policy.policy_status !== "active" || policy.route !== "kernel_task_intent") {
		return {
			result: errorResult(
				"intent_authoring_not_routed",
				"intent authoring requires the active kernel_task_intent routing policy",
				1,
			),
			journal: journalFor(
				"intent",
				null,
				"rejected",
				"routing_unavailable",
				null,
				"Activate the Git-owned managed-task routing policy before authoring.",
			),
		};
	}

	// Existing managed ownership rejects before opening the destination.
	const owner = intentActiveOwner(root);
	if (owner.kernel)
		return {
			result: errorResult(
				"kernel_owner_active",
				"an active Kernel claim already owns this workspace; authoring is blocked",
				1,
			),
			journal: journalFor(
				"intent",
				null,
				"rejected",
				"kernel_owner_active",
				null,
				"Route to imm-loop instead of authoring a new draft.",
			),
		};
	if (owner.v3)
		return {
			result: errorResult(
				"v3_owner_nonterminal",
				"a nonterminal v3 Plan owns this workspace; authoring is blocked",
				1,
			),
			journal: journalFor(
				"intent",
				null,
				"rejected",
				"v3_owner_nonterminal",
				null,
				"Finish or terminate the active v3 Plan before authoring.",
			),
		};

	// Bounded stdin candidate, then strict parsing.
	let candidate: string;
	try {
		candidate = readBoundedStdin(INTENT_MAX_BYTES);
	} catch (error) {
		return {
			result: errorResult(
				"candidate_oversize",
				`candidate stdin exceeds the TaskIntent bound: ${error instanceof Error ? error.message : error}`,
				1,
			),
			journal: journalFor(
				"intent",
				null,
				"rejected",
				"input_oversize",
				null,
				"Reduce the candidate below the TaskIntent byte bound.",
			),
		};
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(candidate);
	} catch (error) {
		return {
			result: errorResult(
				"candidate_invalid",
				`candidate is not valid JSON: ${error instanceof Error ? error.message : error}`,
				1,
			),
			journal: journalFor(
				"intent",
				null,
				"rejected",
				"input_invalid",
				null,
				"Submit a complete task_intent/v1 JSON candidate.",
			),
		};
	}
	let intent: ReturnType<typeof parseTaskIntentV1>;
	try {
		intent = parseTaskIntentV1(parsed);
	} catch (error) {
		return {
			result: errorResult(
				"intent_invalid",
				`candidate failed strict task_intent/v1 parsing: ${error instanceof Error ? error.message : error}`,
				1,
			),
			journal: journalFor(
				"intent",
				null,
				"rejected",
				"intent_invalid",
				null,
				"Fix the reported task_intent/v1 violations and retry.",
			),
		};
	}

	// Task/path identity: destination must be docs/plans/<task-id>.intent.json.
	let sidecarPath: string;
	try {
		sidecarPath = intentSidecarPath(intent.task_id);
	} catch (error) {
		return {
			result: errorResult(
				"task_id_invalid",
				`task id is invalid: ${error instanceof Error ? error.message : error}`,
				1,
			),
			journal: journalFor(
				"intent",
				null,
				"rejected",
				"intent_invalid",
				null,
				"Use a task id matching the sidecar naming convention.",
			),
		};
	}
	if (pathArg !== sidecarPath && resolve(root, pathArg) !== resolve(root, sidecarPath)) {
		return {
			result: errorResult(
				"task_path_mismatch",
				`destination must be ${sidecarPath} for task ${intent.task_id}`,
				1,
			),
			journal: journalFor(
				"intent",
				null,
				"rejected",
				"task_path_mismatch",
				null,
				"Author the intent to its canonical sidecar path.",
			),
		};
	}

	// Canonicalize every acceptance verification string through the shared parser.
	let canonicalAcceptance: Array<{
		id: string;
		assertion: string;
		verification: string;
	}>;
	try {
		canonicalAcceptance = intent.acceptance.map((item) => ({
			id: item.id,
			assertion: item.assertion,
			verification: canonicalDescriptorBytes(
				parseVerificationDescriptor(item.verification),
			),
		}));
	} catch (error) {
		return {
			result: errorResult(
				"intent_invalid",
				`candidate acceptance verification failed strict verification_descriptor/v1 parsing: ${error instanceof Error ? error.message : error}`,
				1,
			),
			journal: journalFor(
				"intent",
				null,
				"rejected",
				"intent_invalid",
				null,
				"Fix the reported verification_descriptor/v1 violations and retry.",
			),
		};
	}
	const canonicalIntent = {
		contract: intent.contract,
		task_id: intent.task_id,
		owner: intent.owner,
		goal: intent.goal,
		acceptance: canonicalAcceptance,
		scope_hint: intent.scope_hint,
		risk: intent.risk,
		revision: intent.revision,
	};
	const canonicalBytes = `${JSON.stringify(canonicalIntent, null, 2)}\n`;
	const contentHash = canonicalIntentHash(canonicalIntent);

	// Exclusive no-overwrite creation of exactly one regular file.
	const destination = resolve(root, sidecarPath);
	if (!destination.startsWith(resolve(root) + "/"))
		return {
			result: errorResult("destination_invalid", "destination escapes the project root", 1),
			journal: journalFor(
				"intent",
				null,
				"rejected",
				"destination_invalid",
				null,
				"The intent destination must stay inside the project.",
			),
		};
	const parent = resolve(root, INTENT_SIDECAR_PREFIX);
	try {
		const parentStat = lstatSync(parent);
		if (!parentStat.isDirectory())
			return {
				result: errorResult("destination_parent_invalid", "docs/plans is not a directory", 1),
				journal: journalFor(
					"intent",
					null,
					"rejected",
					"destination_parent_invalid",
					null,
					"The docs/plans directory must exist.",
				),
			};
	} catch {
		return {
			result: errorResult(
				"destination_parent_missing",
				"docs/plans does not exist; parent creation is never implicit",
				1,
			),
			journal: journalFor(
				"intent",
				null,
				"rejected",
				"destination_parent_missing",
				null,
				"Create docs/plans explicitly before authoring.",
			),
		};
	}
	let fd: number;
	try {
		fd = openSync(
			destination,
			fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY,
			0o644,
		);
	} catch (error) {
		const code = (error as { code?: string }).code;
		const reason =
			code === "EEXIST"
				? "destination already exists; no-overwrite authoring never replaces it"
				: code === "ENOENT"
					? "destination parent does not exist"
					: `destination cannot be created: ${error instanceof Error ? error.message : error}`;
		return {
			result: errorResult("destination_exists", reason, 1),
			journal: journalFor(
				"intent",
				null,
				"rejected",
				"destination_exists",
				null,
				"Remove or rename the existing file; drafts are never overwritten.",
			),
		};
	}
	try {
		writeFileSync(fd, canonicalBytes, "utf8");
	} catch (error) {
		closeSync(fd);
		return {
			result: errorResult(
				"destination_write_failed",
				`draft write failed: ${error instanceof Error ? error.message : error}`,
				1,
			),
			journal: journalFor(
				"intent",
				null,
				"rejected",
				"destination_write_failed",
				null,
				"Retry authoring after fixing the destination.",
			),
		};
	}
	closeSync(fd);

	return {
		result: jsonResult(
			{
				contract: "assurance_kernel/intent_author/v1",
				path: sidecarPath,
				task_id: intent.task_id,
				content_hash: contentHash,
				revision: intent.revision,
				git_tracked: false,
				enrollment_ready: false,
			},
			0,
		),
		journal: journalFor(
			"intent",
			null,
			"ok",
			"command_ok",
			null,
			null,
		),
	};
}

/**
 * Canonical `imm-kernel intent validate <path> --json`.
 * Zero writes: no friction journal, migration, lock, receipt, observation,
 * TaskRecord, claim, Ledger, Git index, or session write. Returns a stable
 * bounded projection.
 */
function runIntentValidate(args: string[], root: string): KernelExecution {
	const nonFlags = args.filter((arg) => !arg.startsWith("-"));
	if (nonFlags.length !== 1)
		return {
			result: errorResult(
				"invalid_command",
				"imm-kernel intent validate requires exactly one path",
				2,
			),
			journal: journalFor(
				"intent",
				null,
				"rejected",
				"invalid_command",
				null,
				"Run imm-kernel intent validate <path> --json.",
			),
		};
	const unsupported = args.filter(
		(arg) => arg.startsWith("-") && !["--json"].includes(arg),
	);
	if (unsupported.length > 0)
		return {
			result: errorResult("invalid_command", `unsupported intent validate option: ${unsupported[0]}`, 2),
			journal: journalFor(
				"intent",
				null,
				"rejected",
				"invalid_command",
				null,
				"Run imm-kernel intent validate <path> --json.",
			),
		};
	const pathArg = nonFlags[0];

	// Canonical-root containment, no symlink components.
	let canonicalRoot: string;
	try {
		canonicalRoot = resolve(root);
	} catch {
		return {
			result: errorResult("root_invalid", "project root is unavailable", 1),
			journal: journalFor(
				"intent",
				null,
				"rejected",
				"source_read_failed",
				null,
				null,
			),
		};
	}
	const target = resolve(canonicalRoot, pathArg);
	const relative = target.startsWith(canonicalRoot + "/")
		? target.slice(canonicalRoot.length + 1)
		: null;
	if (!relative || !relative.startsWith(INTENT_SIDECAR_PREFIX) || !relative.endsWith(".intent.json")) {
		return {
			result: errorResult(
				"path_invalid",
				"intent path must be docs/plans/<task-id>.intent.json inside the project",
				1,
			),
			journal: journalFor(
				"intent",
				null,
				"rejected",
				"source_invalid",
				null,
				"Validate a canonical intent sidecar path.",
			),
		};
	}
	const taskId = relative
		.slice(INTENT_SIDECAR_PREFIX.length)
		.replace(/\.intent\.json$/, "");

	let raw: string;
	try {
		raw = readSecureProjectFile(root, relative);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return {
			result: jsonResult(
				{
					contract: "assurance_kernel/intent_validation/v1",
					valid: false,
					path: relative,
					task_id: taskId,
					reason: message,
				},
				0,
			),
			journal: journalFor(
				"intent",
				null,
				"ok",
				"command_ok",
				null,
				null,
			),
		};
	}
	if (Buffer.byteLength(raw, "utf8") > INTENT_MAX_BYTES) {
		return {
			result: jsonResult(
				{
					contract: "assurance_kernel/intent_validation/v1",
					valid: false,
					path: relative,
					task_id: taskId,
					reason: "intent sidecar exceeds 64 KiB",
				},
				0,
			),
			journal: journalFor(
				"intent",
				null,
				"ok",
				"command_ok",
				null,
				null,
			),
		};
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch (error) {
		return {
			result: jsonResult(
				{
					contract: "assurance_kernel/intent_validation/v1",
					valid: false,
					path: relative,
					task_id: taskId,
					reason: `not valid JSON: ${error instanceof Error ? error.message : error}`,
				},
				0,
			),
			journal: journalFor(
				"intent",
				null,
				"ok",
				"command_ok",
				null,
				null,
			),
		};
	}

	// Strict parse + verification eligibility per acceptance item.
	let intent: ReturnType<typeof parseTaskIntentV1>;
	try {
		intent = parseTaskIntentV1(parsed);
	} catch (error) {
		return {
			result: jsonResult(
				{
					contract: "assurance_kernel/intent_validation/v1",
					valid: false,
					path: relative,
					task_id: taskId,
					reason: `strict task_intent/v1 parsing failed: ${error instanceof Error ? error.message : error}`,
				},
				0,
			),
			journal: journalFor(
				"intent",
				null,
				"ok",
				"command_ok",
				null,
				null,
			),
		};
	}
	if (intent.task_id !== taskId) {
		return {
			result: jsonResult(
				{
					contract: "assurance_kernel/intent_validation/v1",
					valid: false,
					path: relative,
					task_id: taskId,
					reason: `intent.task_id ${intent.task_id} does not match the sidecar filename task id`,
				},
				0,
			),
			journal: journalFor(
				"intent",
				null,
				"ok",
				"command_ok",
				null,
				null,
			),
		};
	}

	const verification: Array<{ id: string; eligible: boolean; reason: string | null }> = [];
	let allEligible = true;
	for (const item of intent.acceptance) {
		try {
			parseVerificationDescriptor(item.verification);
			verification.push({ id: item.id, eligible: true, reason: null });
		} catch (error) {
			allEligible = false;
			verification.push({
				id: item.id,
				eligible: false,
				reason: error instanceof Error ? error.message : String(error),
			});
		}
	}

	// Git ownership status: tracked, untracked, or unavailable.
	let gitTracked: boolean;
	try {
		execFileSync(
			"git",
			["ls-files", "--error-unmatch", "--", relative],
			{ cwd: canonicalRoot, stdio: ["ignore", "pipe", "pipe"] },
		);
		gitTracked = true;
	} catch {
		gitTracked = false;
	}

	const contentHash = canonicalIntentHash(intent);
	const enrollmentReady = gitTracked && allEligible;
	return {
		result: jsonResult(
			{
				contract: "assurance_kernel/intent_validation/v1",
				valid: true,
				path: relative,
				task_id: intent.task_id,
				content_hash: contentHash,
				risk: intent.risk,
				acceptance_ids: intent.acceptance.map((item) => item.id),
				verification: verification,
				git_ownership: gitTracked ? "tracked" : "untracked",
				enrollment_ready: enrollmentReady,
			},
			0,
		),
		journal: journalFor(
			"intent",
			null,
			"ok",
			"command_ok",
			null,
			null,
		),
	};
}

function executeKernelCommand(args: string[], root: string): KernelExecution {
	const command = args[0] ?? "";
	const flags = args.slice(1);
	if (command === "intent") {
		const sub = args[1] ?? "";
		if (sub === "author") return runIntentAuthor(args.slice(2), root);
		if (sub === "validate") return runIntentValidate(args.slice(2), root);
		return {
			result: errorResult(
				"invalid_command",
				"usage: imm-kernel intent author <path> --stdin --json | validate <path> --json",
				2,
			),
			journal: journalFor(
				"intent",
				null,
				"rejected",
				"invalid_command",
				null,
				"Run imm-kernel intent --help.",
			),
		};
	}
	if (command === "status") {
		if (flags.some((flag) => flag !== "--json"))
			return {
				result: errorResult("invalid_command", "status accepts only --json", 2),
				journal: journalFor(
					command,
					null,
					"rejected",
					"invalid_command",
					null,
					"Run imm-kernel status --json.",
				),
			};
		return runStatus(root);
	}
	if (command === "audit") {
		if (args.length !== 2 || args[1] !== "--legacy")
			return {
				result: errorResult(
					"invalid_command",
					"audit accepts only --legacy",
					2,
				),
				journal: journalFor(
					"audit",
					null,
					"rejected",
					"invalid_command",
					null,
					"Run imm-kernel audit --legacy.",
				),
			};
		try {
			return {
				result: jsonResult(projectLegacyAudit(root)),
				journal: journalFor(
					"audit",
					null,
					"ok",
					"command_ok",
					null,
					null,
				),
			};
		} catch (error) {
			return sourceFailure("audit", error);
		}
	}
	if (command === "--help" || command === "help")
		return {
			result: {
				stdout:
					"usage: imm-kernel status --json\n       imm-kernel audit --legacy\n       imm-kernel intent author <path> --stdin --json\n       imm-kernel intent validate <path> --json\n",
				stderr: "",
				returncode: 0,
			},
			journal: journalFor("help", null, "ok", "command_ok", null, null),
		};
	return {
		result: errorResult(
			"invalid_command",
			"usage: imm-kernel status --json | audit --legacy | intent author <path> --stdin --json | intent validate <path> --json",

			2,
		),
		journal: journalFor(
			command || "<missing>",
			null,
			"rejected",
			"invalid_command",
			null,
			"Run imm-kernel --help.",
		),
	};
}

export function runKernelCommand(
	args: string[],
	root = process.cwd(),
): KernelCommandResult {
	const execution = executeKernelCommand(args, root);
	// Retained read-only commands (intent/status/audit) and retired
	// subcommands (migrate/readiness/journal) are no-journal: they never
	// append the friction journal. Only the fallback unknown-command path
	// keeps journaling.
	if (["intent", "status", "audit", "migrate", "readiness", "journal"].includes(args[0] ?? ""))
		return execution.result;
	let warning = "";
	try {
		appendJournalEntry(root, {
			contract: "assurance_kernel/journal/v1",
			timestamp: new Date().toISOString(),
			...execution.journal,
		});
	} catch (error) {
		warning = `warning: kernel journal append failed: ${error instanceof Error ? error.message : error}\n`;
	}
	return {
		...execution.result,
		stderr: `${execution.result.stderr}${warning}`,
	};
}

async function main(args: string[]): Promise<number> {
	const result = runKernelCommand(args);
	if (result.stdout) process.stdout.write(result.stdout);
	if (result.stderr) process.stderr.write(result.stderr);
	return result.returncode;
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
	process.exit(await main(process.argv.slice(2)));
}
