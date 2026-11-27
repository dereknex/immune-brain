import {
	closeSync,
	constants as fsConstants,
	existsSync,
	lstatSync,
	openSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { projectScopeOverlap } from "../kernel/scope_overlap";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
	KernelStoreSecurityError,
	appendJournalEntry,
	readSecureProjectFile,
	readTaskRecordRaw,
	readWorkspaceStateRaw,
	type JournalEntry,
	type JournalReasonCode,
	type TaskPhase,
} from "../kernel";
import {
	INTENT_MAX_BYTES,
	canonicalIntentHash,
	parseProjectTaskIntent,
	parseTaskIntentV1,
	readTaskIntent,
} from "../kernel/intent";
import {
	floorMatchingScopeEntries,
	floorScopePrefixes,
	readRiskFloor,
	type RiskFloor,
} from "../kernel/risk_floor";

/** The declared routine class ids (ADR 0038), or null when none are declared. */
function routineClassIds(floor: RiskFloor): string[] | null {
	return floor.routine ? floor.routine.map((item) => item.id) : null;
}
import { inspectSpecBinding } from "../kernel/spec_binding";
import { projectTask, resolveProjectedRisk, routineAllowlistEscapes } from "../kernel/completion";
import { deriveAssuranceAuthorization } from "../kernel/assurance_projection";
import { taskDeliveryIdentity } from "../workspace_scope";
import type { TaskIntentV1, TaskRisk } from "../kernel/types";
import {
	canonicalDescriptorBytes,
	parseVerificationDescriptor,
} from "../verification_descriptor";
import { inspectRoutingPolicy } from "../managed_task_routing_policy"
import { projectLegacyAudit } from "../kernel/legacy_audit";
import { inspectStorageLayout } from "../kernel/storage_paths";
import { commitPendingMigrationDiff, migrateAndCommitLegacyLayout } from "../kernel/storage_layout_migration";
import { readBackendClaim } from "../kernel/backend_claim";
import { inspectEnrollmentGitBase, type EnrollmentGitBase } from "../assurance/enrollment_git_base";
import { probeKernelStore } from "../kernel";
import { scopeEstimateFailure } from "../kernel/intent_readiness";
import { randomUUID } from "node:crypto";
import { dirname } from "node:path";
import { resolveConfig } from "../config/layered_config";
import { canonicalActorId, LITERAL_USER_ACTOR_ID } from "../kernel/actor_identity";
import { enrollTask } from "../kernel/enrollment";
import { createEnrollmentAuthorityRegistry } from "../kernel/enrollment_authority";
import { preparePiCanary } from "../kernel/pi_canary_prepare";
import { createMutationAuthorityRegistry, digestOfAction, type CapabilityBindingV2 } from "../kernel/authority_port";
import { capabilityActionFor, createCanaryApplication } from "../kernel/canary_application";
import { projectAssurance } from "../kernel/assurance_projection";
import { currentRunId, localRunId, readAuditTaskPair, recoverKernelStoreFollowUps } from "../kernel/storage";
import { auditEvidencePaths, auditRunDirPath, auditRunRecordPath } from "../kernel/storage_paths";
import { stagePlanningArtifactTransition } from "../assurance/verdict_authority";

export interface KernelCommandResult {
	stdout: string;
	stderr: string;
	returncode: number;
}

interface KernelExecution {
	result: KernelCommandResult;
	journal: Omit<JournalEntry, "contract" | "timestamp">;
}

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
			"Resolve the reported storage or legacy-reader condition before retrying.",
		),
	};
}

/**
 * `status --json` is strictly read-only and reports layout facts plus Kernel
 * ownership facts. It never projects the archived v3 Ledger as current
 * authority; `audit --legacy` is the only legacy reader.
 */
function runStatus(root: string): KernelExecution {
	try {
		const layout = inspectStorageLayout(root);
		const claim = readBackendClaim(root);
		const workspace = readWorkspaceOwner(root);
		return {
			result: jsonResult({
				contract: "assurance_kernel/status/v1",
				layout,
				kernel: {
					claim: claim
						? {
								task_id: claim.task_id,
								lifecycle_status: claim.lifecycle_status,
							}
						: null,
					workspace: { current_working: workspace },
				},
			}),
			journal: journalFor(
				"status",
				null,
				layout.layout === "ready" || layout.layout === "migration_uncommitted" ? "ok" : "escalated",
				layout.layout === "ready" ? "command_ok" : "source_invalid",
				null,
				layout.reason,
			),
		};
	} catch (error) {
		return sourceFailure("status", error);
	}
}

const UNOBSERVABLE = {
	capability: "unobservable",
	rehearsal: "unobservable",
	cas_holder: "unobservable",
} as const;

const RISK_ORDER: Record<TaskRisk, number> = {
	routine: 0,
	material: 1,
	critical: 2,
};

function readWorkspaceOwner(root: string): string | null {
	try {
		return readWorkspaceStateRaw(root).state.current_working;
	} catch {
		return null;
	}
}

/**
 * `inspect --json` is a read-only Inspect Projection. It never journals,
 * never takes a Kernel store lock, and never becomes authority.
 */
interface InspectTarget {
	task_id: string | null;
	run_id: string | null;
}

function runInspect(root: string, target: InspectTarget = { task_id: null, run_id: null }): KernelExecution {
	try {
		const layout = inspectStorageLayout(root);
		const claim = readBackendClaim(root);
		const workspace = readWorkspaceOwner(root);
		const kernel = {
			claim: claim
				? {
						task_id: claim.task_id,
						lifecycle_status: claim.lifecycle_status,
					}
				: null,
			workspace: { current_working: workspace },
		};
		const floor = readRiskFloor(root);
		const idleRisk = {
			declared: null as TaskRisk | null,
			resolved: null as TaskRisk | null,
			floor_prefixes: floorScopePrefixes(floor),
			floor_invalid: floor.invalid,
			floor_applied: false,
			matching_scope_entries: [] as string[],
			routine_classes: routineClassIds(floor),
			outside_routine_allowlist: [] as string[],
		};
		const ok = layout.layout === "ready" || layout.layout === "migration_uncommitted";
		// A named task without an active claim, or an explicit run, reads settled
		// audit evidence: read-only, lock-free, journal-free (BR-DEC-5).
		if (target.task_id !== null && (target.run_id !== null || !claim || claim.task_id !== target.task_id))
			return runInspectAudit(root, target.task_id, target.run_id, { layout, kernel, risk: idleRisk });
		if (!claim || !ok || layout.layout !== "ready") {
			return {
				result: jsonResult({
					contract: "assurance_kernel/inspect/v1",
					layout,
					kernel,
					assurance: null,
					risk: idleRisk,
					unobservable: UNOBSERVABLE,
				}),
				journal: journalFor(
					"inspect",
					null,
					ok ? "ok" : "escalated",
					layout.layout === "ready" ? "command_ok" : "source_invalid",
					null,
					layout.reason,
				),
			};
		}
		let recordRead: ReturnType<typeof readTaskRecordRaw>;
		try {
			recordRead = readTaskRecordRaw(root, claim.task_id);
		} catch (error) {
			return sourceFailure("inspect", error);
		}
		if (!recordRead.record) {
			return {
				result: errorResult(
					"source_read_failed",
					`task ${claim.task_id} has no TaskRecord`,
					1,
				),
				journal: journalFor(
					"inspect",
					null,
					"rejected",
					"source_read_failed",
					claim.task_id,
					"Resolve the claimed TaskRecord before retrying inspect.",
				),
			};
		}
		const record = recordRead.record;
		let declared: TaskRisk;
		let intent: TaskIntentV1;
		try {
			const raw = JSON.parse(
				readSecureProjectFile(root, record.intent_ref.path),
			) as { risk?: unknown };
			if (raw.risk !== "routine" && raw.risk !== "material" && raw.risk !== "critical")
				throw new Error(`intent.risk is unreadable for ${claim.task_id}`);
			declared = raw.risk;
			intent = parseProjectTaskIntent(root, raw, record.intent_snapshot);
			if (canonicalIntentHash(intent) !== record.intent_ref.content_hash)
				throw new Error("TaskIntent sidecar does not match TaskRecord content hash");
		} catch (error) {
			return sourceFailure("inspect", error);
		}
		const workspaceState = readWorkspaceStateRaw(root);
		let identity;
		try {
			identity = taskDeliveryIdentity(root, record);
		} catch (error) {
			return sourceFailure("inspect", error);
		}
		const diffHash = identity.diff_hash;
		const changedPaths = identity.changed_paths;
		const decision = projectTask(intent, record, diffHash, record.intent_ref.content_hash, changedPaths, floor);
		const openUserDecisions = record.findings.filter(
			(finding) => finding.kind === "unresolved_user_decision" && finding.status === "open",
		);
		const openUserDecisionCount = openUserDecisions.length;
		const resolved = resolveProjectedRisk(intent, changedPaths, floor);
		return {
			result: jsonResult({
				contract: "assurance_kernel/inspect/v1",
				layout,
				kernel,
				assurance: {
					contract: "assurance_kernel/assurance_projection/v1",
					task_id: claim.task_id,
					error: null,
					claim: kernel.claim,
					projection: {
						record_revision: recordRead.revision,
						workspace_revision: workspaceState.revision,
						intent_revision: intent.revision,
						intent_content_hash: record.intent_ref.content_hash,
						diff_hash: diffHash,
						lifecycle: record.lifecycle,
						artifact_state: record.artifact_state,
						risk: resolved,
						next_obligation: decision.next_obligation,
						fresh_acceptance_ids: decision.fresh_acceptance_ids,
						missing_acceptance_ids: decision.missing_acceptance_ids,
						stale_attestation_ids: decision.stale_attestation_ids,
						fresh_approval_kinds: [],
						missing_approval_kinds: decision.missing_approval_kinds,
						blocking_finding_ids: decision.blocking_finding_ids,
						unresolved_user_decision_ids: decision.unresolved_user_decision_ids,
						replan_required_ids: decision.replan_required_ids,
						independence_violations: decision.independence_violations,
						open_user_decision_count: openUserDecisionCount,
						unresolved_user_decisions: openUserDecisions.map((finding) => ({
							id: finding.id,
							summary: finding.summary,
							acceptance_id: finding.acceptance_id ?? null,
						})),
						completion_ready: decision.complete,
						authorization: deriveAssuranceAuthorization({
							next_obligation: decision.next_obligation,
							open_user_decision_count: openUserDecisionCount,
						}),
					},
				},
				risk: {
					declared,
					resolved,
					floor_prefixes: floorScopePrefixes(floor),
					floor_invalid: floor.invalid,
					floor_applied: RISK_ORDER[resolved] > RISK_ORDER[declared],
					matching_scope_entries: floorMatchingScopeEntries(intent.scope_hint, floor),
					routine_classes: routineClassIds(floor),
					outside_routine_allowlist: routineAllowlistEscapes(intent, changedPaths, floor),
				},
				unobservable: UNOBSERVABLE,
				...(target.task_id !== null ? { audit: null } : {}),
			}),
			journal: journalFor("inspect", null, "ok", "command_ok", claim.task_id, null),
		};
	} catch (error) {
		return sourceFailure("inspect", error);
	}
}

const RUN_ID_PATTERN = /^run-[A-Za-z0-9-]+$/;

/**
 * Settled audit verification for `inspect --task <id> [--run <run-id>]`.
 * The run is the explicit `--run`, else the local terminal run when the store
 * already exists (never created here), else the single run directory the audit
 * tree holds. `readAuditTaskPair` validates the pair's identity and hashes.
 */
function runInspectAudit(
	root: string,
	taskId: string,
	explicitRunId: string | null,
	base: { layout: unknown; kernel: unknown; risk: unknown },
): KernelExecution {
	const failure = (code: string, message: string): KernelExecution => ({
		result: errorResult(code, message, 1),
		journal: journalFor("inspect", null, "rejected", "source_invalid", taskId, null),
	});
	let runId = explicitRunId;
	if (runId === null) {
		try {
			const local = localRunId(root, taskId);
			if (local !== null && local !== currentRunId(root, taskId)) runId = local;
		} catch {
			runId = null;
		}
	}
	let pair: ReturnType<typeof readAuditTaskPair>;
	try {
		pair = readAuditTaskPair(root, taskId, runId ?? undefined);
	} catch (error) {
		return failure("task_audit_invalid", error instanceof Error ? error.message : String(error));
	}
	if (!pair) return failure("task_audit_missing", `no settled audit evidence for task ${taskId}`);
	const recordPath = runId !== null ? auditRunRecordPath(taskId, runId) : auditEvidencePaths(root, taskId).record;
	const auditDir = dirname(recordPath);
	const dirName = auditDir.slice(auditDir.lastIndexOf("/") + 1);
	const record = pair.record as { lifecycle?: string; phase?: string; intent_ref?: { content_hash?: string }; confirmation_source?: string };
	return {
		result: jsonResult({
			contract: "assurance_kernel/inspect/v1",
			layout: base.layout,
			kernel: base.kernel,
			assurance: null,
			risk: base.risk,
			unobservable: UNOBSERVABLE,
			audit: {
				valid: true,
				task_id: taskId,
				run_id: runId ?? (RUN_ID_PATTERN.test(dirName) ? dirName : null),
				lifecycle: record.lifecycle ?? record.phase ?? null,
				audit_dir: auditDir,
				intent_content_hash: record.intent_ref?.content_hash ?? null,
				final_record_hash: pair.proof.final_record_hash,
				confirmation_source: record.confirmation_source ?? null,
			},
		}),
		journal: journalFor("inspect", null, "ok", "command_ok", taskId, null),
	};
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
		const claim = readBackendClaim(root);
		kernelOwner = claim !== null;
	} catch {
		kernelOwner = false;
	}
	try {
		const state = JSON.parse(
			readSecureProjectFile(root, ".imm/memory/current_iteration.json"),
		) as Record<string, unknown>;
		if (typeof state.runtime_status === "string" && state.runtime_status !== "idle")
			v3Owner = true;
	} catch {
		// No readable v3 Ledger means no v3 owner.
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

	// Pending diffs may be committed; conversion stays on the explicit command.
	let layout = inspectStorageLayout(root);
	if (layout.layout === "migration_uncommitted") {
		try {
			commitPendingMigrationDiff(root);
			layout = inspectStorageLayout(root);
		} catch (error) {
			return sourceFailure("intent", error);
		}
	}
	if (layout.layout === "migration_blocked_active") {
		return {
			result: errorResult(
				"layout_migration_blocked",
				layout.reason ?? "an active old-layout owner blocks migration",
				1,
			),
			journal: journalFor(
				"intent",
				null,
				"rejected",
				"source_invalid",
				null,
				"Settle or stop the active old-layout owner with the prior runtime before authoring.",
			),
		};
	}
	if (layout.layout === "recovery_required" || layout.layout === "migration_required") {
		// Authoring never migrates implicitly: the retired layout is converted by
		// the explicit claimless command only, so creating a draft cannot publish a
		// database or retire historical files behind the operator's back.
		return {
			result: errorResult(
				layout.layout === "recovery_required" ? "layout_recovery_required" : "layout_migration_required",
				`${layout.reason ?? "storage layout is not ready"}; run imm-kernel migrate --storage-layout first`,
				1,
			),
			journal: journalFor(
				"intent",
				null,
				"rejected",
				"source_invalid",
				null,
				"Run imm-kernel migrate --storage-layout, then retry intent author.",
			),
		};
	}
	if (layout.layout !== "ready") {
		return {
			result: errorResult(
				"layout_not_ready",
				layout.reason ?? `storage layout is ${layout.layout}`,
				1,
			),
			journal: journalFor(
				"intent",
				null,
				"rejected",
				"source_invalid",
				null,
				"Resolve the reported layout condition before retrying authoring.",
			),
		};
	}

	try {
		probeKernelStore(root);
	} catch (error) {
		return sourceFailure("intent", error);
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
				"Route to drive instead of authoring a new draft.",
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
		intent = parseProjectTaskIntent(root, parsed);
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

	let scopeFailure: string | null;
	try { scopeFailure = scopeEstimateFailure(root, intent); }
	catch (error) { return sourceFailure("intent", error); }
	if (scopeFailure) return {
		result: errorResult("scope_estimate_too_wide", scopeFailure, 1),
		journal: journalFor("intent", null, "rejected", "intent_invalid", null, scopeFailure),
	};

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
				`candidate acceptance verification failed strict verification_descriptor/v2 parsing: ${error instanceof Error ? error.message : error}`,
				1,
			),
			journal: journalFor(
				"intent",
				null,
				"rejected",
				"intent_invalid",
				null,
				"Fix the reported verification_descriptor/v2 violations and retry.",
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
		...(intent.scope_size_reason === undefined ? {} : { scope_size_reason: intent.scope_size_reason }),
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
/**
 * Read-only: compare the `scope_hint` of two or more TaskIntents of one
 * Initiative and report every overlapping entry pair plus the start waves the
 * Batch Plan would use. Optional `--blocked-by a=b,c` edges order the waves the
 * way the Initiative's dependencies do. Writes nothing.
 */
function runIntentOverlap(args: string[], root: string): KernelExecution {
	const usage = "Run imm-kernel intent overlap <path> <path>... [--blocked-by <task-id>=<task-id>,...] --json.";
	const reject = (message: string): KernelExecution => ({
		result: errorResult("invalid_command", message, 2),
		journal: journalFor("intent", null, "rejected", "invalid_command", null, usage),
	});
	const paths: string[] = [];
	const blockedBy = new Map<string, string[]>();
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index]!;
		if (arg === "--json") continue;
		if (arg === "--blocked-by") {
			const edge = args[++index] ?? "";
			const match = /^([A-Za-z0-9][A-Za-z0-9._-]*)=([A-Za-z0-9._,-]+)$/.exec(edge);
			if (!match) return reject(`invalid --blocked-by edge: ${edge}`);
			blockedBy.set(match[1]!, match[2]!.split(",").filter(Boolean));
			continue;
		}
		if (arg.startsWith("-")) return reject(`unsupported intent overlap option: ${arg}`);
		paths.push(arg);
	}
	if (paths.length < 2) return reject("imm-kernel intent overlap requires at least two paths");
	const children: Array<{ task_id: string; blocked_by: string[]; scope_hint: string[] }> = [];
	for (const path of paths) {
		let intent: { task_id?: unknown; scope_hint?: unknown };
		try {
			intent = JSON.parse(readFileSync(resolve(root, path), "utf8"));
		} catch (error) {
			return { result: errorResult("source_invalid", `cannot read ${path}: ${error instanceof Error ? error.message : String(error)}`, 1), journal: journalFor("intent", null, "rejected", "source_read_failed", null, usage) };
		}
		if (typeof intent.task_id !== "string" || !Array.isArray(intent.scope_hint) || intent.scope_hint.some((entry) => typeof entry !== "string"))
			return { result: errorResult("source_invalid", `${path} has no task_id and string scope_hint`, 1), journal: journalFor("intent", null, "rejected", "source_invalid", null, usage) };
		children.push({ task_id: intent.task_id, blocked_by: [], scope_hint: intent.scope_hint as string[] });
	}
	const known = new Set(children.map((child) => child.task_id));
	for (const child of children) child.blocked_by = (blockedBy.get(child.task_id) ?? []).filter((id) => known.has(id));
	let report: ReturnType<typeof projectScopeOverlap>;
	try {
		report = projectScopeOverlap(children);
	} catch (error) {
		return reject(error instanceof Error ? error.message : String(error));
	}
	return { result: jsonResult(report, 0), journal: journalFor("intent", null, "ok", "command_ok", null, null) };
}

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

	// Shared zero-write gate (review-4): validation reports the layout
	// condition instead of reading authority bytes while migration/recovery
	// is pending.
	const layout = inspectStorageLayout(root);
	if (!["ready", "migration_uncommitted"].includes(layout.layout))
		return {
			result: errorResult(
				"layout_not_ready",
				`intent validate blocked by storage layout (${layout.layout}): ${layout.reason ?? ""}`,
				1,
			),
			journal: journalFor(
				"intent",
				null,
				"rejected",
				"source_invalid",
				null,
				layout.reason,
			),
		};

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
		intent = parseProjectTaskIntent(root, parsed);
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
	const specBinding = inspectSpecBinding(intent);
	if (!specBinding.ok) {
		return {
			result: jsonResult(
				{
					contract: "assurance_kernel/intent_validation/v1",
					valid: false,
					path: relative,
					task_id: intent.task_id,
					reason: specBinding.message,
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

	let gitBase: EnrollmentGitBase | { state: "invalid"; reason: string };
	try { gitBase = inspectEnrollmentGitBase(canonicalRoot); }
	catch (error) { gitBase = { state: "invalid", reason: error instanceof Error ? error.message : String(error) }; }
	const contentHash = canonicalIntentHash(intent);
	let scopeFailure: string | null;
	try { scopeFailure = scopeEstimateFailure(root, intent); }
	catch (error) { return sourceFailure("intent", error); }
	const enrollmentReady = gitTracked && allEligible && gitBase.state !== "invalid" && !scopeFailure;
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
				git_base: gitBase,
				git_base_initialization_required: gitBase.state === "unborn",
				enrollment_ready: enrollmentReady,
				...(scopeFailure ? { code: "scope_estimate_too_wide", reason: scopeFailure } : {}),
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

function parseInspectFlags(flags: string[]): InspectTarget | null {
	let json = false;
	let task: string | null = null;
	let run: string | null = null;
	for (let i = 0; i < flags.length; i++) {
		const flag = flags[i];
		if (flag === "--json" && !json) json = true;
		else if (flag === "--task" && task === null && flags[i + 1] !== undefined) task = flags[++i];
		else if (flag === "--run" && run === null && flags[i + 1] !== undefined) run = flags[++i];
		else return null;
	}
	if (!json) return null;
	if (run !== null && task === null) return null;
	if (task !== null && !TASK_ID_PATTERN.test(task)) return null;
	if (run !== null && !RUN_ID_PATTERN.test(run)) return null;
	return { task_id: task, run_id: run };
}

function executeKernelCommand(args: string[], root: string): KernelExecution {
	const command = args[0] ?? "";
	const flags = args.slice(1);
	if (command === "intent") {
		const sub = args[1] ?? "";
		if (sub === "author") return runIntentAuthor(args.slice(2), root);
		if (sub === "validate") return runIntentValidate(args.slice(2), root);
		if (sub === "overlap") return runIntentOverlap(args.slice(2), root);
		return {
			result: errorResult(
				"invalid_command",
				"usage: imm-kernel intent author <path> --stdin --json | validate <path> --json | overlap <path> <path>... [--blocked-by <task-id>=<task-id>,...] --json",
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
	if (command === "inspect") {
		const target = parseInspectFlags(flags);
		if (!target)
			return {
				result: errorResult("invalid_command", "inspect accepts only [--task <task-id> [--run <run-id>]] --json", 2),
				journal: journalFor(
					command,
					null,
					"rejected",
					"invalid_command",
					null,
					"Run imm-kernel inspect --json.",
				),
			};
		return runInspect(root, target);
	}
	if (command === "migrate") {
		const validFlags = new Set(["--storage-layout", "--retire-legacy-batches"]);
		const hasPositional = args.slice(1).some((arg) => !arg.startsWith("-"));
		const uniqueFlags = new Set(flags);
		if (
			hasPositional ||
			uniqueFlags.size !== flags.length ||
			!uniqueFlags.has("--storage-layout") ||
			flags.some((flag) => !validFlags.has(flag))
		)
			return {
				result: errorResult(
					"invalid_command",
					"migrate accepts only --storage-layout [--retire-legacy-batches]",
					2,
				),
				journal: journalFor(
					command,
					null,
					"rejected",
					"invalid_command",
					null,
					"Run imm-kernel migrate --storage-layout [--retire-legacy-batches].",
				),
			};
		return runStorageLayoutMigration(root, {
			retireLegacyBatches: uniqueFlags.has("--retire-legacy-batches"),
		});
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
		// Shared zero-write gate (review-4): the audit reports the layout
		// condition instead of reading legacy authority while a migration or
		// recovery is pending.
		const layout = inspectStorageLayout(root);
		if (!["ready", "migration_uncommitted"].includes(layout.layout))
			return {
				result: jsonResult({
					contract: "assurance_kernel/legacy_audit/v1",
					source: null,
					read_only: true,
					writes_performed: false,
					plan_path: null,
					runtime_status: null,
					active_step: null,
					step_count: 0,
					phase: null,
					digest: "sha256:none",
					redacted: true,
					layout: {
						layout: layout.layout,
						reason: layout.reason,
						next_action:
							layout.layout === "migration_required"
								? "run imm-kernel migrate --storage-layout, then retry legacy audit"
								: "resolve the reported layout condition before legacy audit",
					},
				}),
				journal: journalFor(
					"audit",
					null,
					"escalated",
					"source_invalid",
					null,
					layout.reason,
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
					"usage: imm-kernel status --json\n       imm-kernel inspect --json\n       imm-kernel audit --legacy\n       imm-kernel intent author <path> --stdin --json\n       imm-kernel intent validate <path> --json\n",
				stderr: "",
				returncode: 0,
			},
			journal: journalFor("help", null, "ok", "command_ok", null, null),
		};
	return {
		result: errorResult(
			"invalid_command",
			"usage: imm-kernel status --json | inspect --json | audit --legacy | intent author <path> --stdin --json | intent validate <path> --json",

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

/**
 * Explicit claimless storage-layout migration.
 *
 * The retired file store is converted here and nowhere else: this command never
 * authors an intent, never opens a task, and never needs an active claim, so a
 * worktree that is still on the retired layout has one reachable entry point.
 * Mutating commands keep their fail-closed gate; this is the command that
 * resolves it.
 */
function runStorageLayoutMigration(
	root: string,
	options?: { retireLegacyBatches?: boolean },
): KernelExecution {
	const inspection = inspectStorageLayout(root);
	// Only a live owner blocks the command. Every other diagnosis is handed to
	// the migrator, which owns the recovery decisions: an interrupted
	// publication shows both stores and must stay reachable through this CLI.
	if (inspection.layout === "migration_blocked_active")
		return {
			result: errorResult(
				"layout_migration_blocked",
				inspection.reason ?? "a live legacy task still owns work; settle or stop it on the prior runtime first",
				1,
			),
			journal: journalFor(
				"migrate",
				null,
				"rejected",
				"source_invalid",
				null,
				"Resolve the reported layout condition, then rerun imm-kernel migrate --storage-layout.",
			),
		};
	const migration = migrateAndCommitLegacyLayout(root, undefined, options);
	if (migration.outcome === "migrated" || migration.outcome === "already_migrated")
		return {
			result: jsonResult({
				contract: "assurance_kernel/migration_completed/v1",
				operation: "storage layout migration",
				layout: "ready",
				affected_paths: migration.affected_paths,
				next_action: "retry the original command",
			}),
			journal: journalFor("migrate", null, "ok", "command_ok", null, "Retry the original command."),
		};
	// Git integration: manual (ADR 0024): the diff is the user's to commit.
	if (migration.outcome === "migration_uncommitted" && migration.affected_paths.length > 0)
		return {
			result: jsonResult({
				contract: "assurance_kernel/migration_uncommitted/v1",
				operation: "storage layout migration",
				layout: "migration_uncommitted",
				affected_paths: migration.affected_paths,
				reason: migration.reason,
				next_action: "commit the listed paths however you prefer, then rerun imm-kernel migrate --storage-layout",
			}, 1),
			journal: journalFor("migrate", null, "rejected", "source_invalid", null,
				"Commit the listed paths, then rerun imm-kernel migrate --storage-layout."),
		};
	return {
		result: errorResult(
			"layout_migration_blocked",
			migration.reason ?? "the storage layout migration did not complete",
			1,
		),
		journal: journalFor(
			"migrate",
			null,
			"rejected",
			"source_invalid",
			null,
			"Resolve the reported layout condition, then rerun imm-kernel migrate --storage-layout.",
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
	if (["intent", "status", "inspect", "audit", "migrate", "readiness", "journal"].includes(args[0] ?? ""))
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

// ---------------------------------------------------------------------------
// `imm-kernel approve`: the opt-in single-machine external approval seam
// (ADR 0043 Slice 2). Default-off behind v2 `external_approval`; only
// Enrollment, `resolve_user_decision` and `stop` are reachable. High-risk
// exception actions and headless QA/Review stay out (BR-OUT-2, BR-OUT-3).
// ---------------------------------------------------------------------------

const APPROVAL_RESULT_CONTRACT = "assurance_kernel/approval_result/v1";

interface ApproveArgs {
	task_id: string;
	mode: "enroll" | "resolve_user_decision" | "stop";
	finding_id?: string;
	resolution?: string;
	reason?: string;
	actor: string | null;
}

function parseApproveArgs(args: string[]): ApproveArgs | string {
	const taskId = args[1];
	if (taskId === undefined || taskId.startsWith("--")) return "approve requires <task-id>";
	if (!TASK_ID_PATTERN.test(taskId)) return `invalid task id: ${taskId}`;
	const values = new Map<string, string>();
	let json = false;
	const rest = args.slice(2);
	for (let i = 0; i < rest.length; i++) {
		const flag = rest[i];
		if (flag === "--json") {
			if (json) return "duplicate flag --json";
			json = true;
			continue;
		}
		if (flag !== "--finding" && flag !== "--resolution" && flag !== "--stop" && flag !== "--actor")
			return `unknown flag: ${flag}`;
		if (values.has(flag)) return `duplicate flag ${flag}`;
		const value = rest[i + 1];
		if (value === undefined) return `${flag} requires a value`;
		values.set(flag, value);
		i++;
	}
	if (!json) return "approve requires --json";
	const finding = values.get("--finding");
	const resolution = values.get("--resolution");
	const stop = values.get("--stop");
	const actor = values.get("--actor");
	if (actor !== undefined && actor.trim().length === 0) return "--actor must be non-empty";
	if (stop !== undefined && (finding !== undefined || resolution !== undefined))
		return "--stop cannot be combined with --finding or --resolution";
	if ((finding === undefined) !== (resolution === undefined))
		return "--finding and --resolution must be given together";
	if (finding !== undefined && (finding.trim().length === 0 || resolution!.trim().length === 0))
		return "--finding and --resolution must be non-empty";
	if (stop !== undefined && stop.trim().length === 0) return "--stop requires a non-empty reason";
	const base = { task_id: taskId, actor: actor ?? null };
	if (stop !== undefined) return { ...base, mode: "stop", reason: stop };
	if (finding !== undefined) return { ...base, mode: "resolve_user_decision", finding_id: finding, resolution: resolution! };
	return { ...base, mode: "enroll" };
}

function gitTracked(root: string, path: string): boolean {
	try {
		execFileSync("git", ["ls-files", "--error-unmatch", "--", path], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
		return true;
	} catch {
		return false;
	}
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/** Reporting only: a read fault must not turn a committed Enrollment into a rejection. */
function runIdForTask(root: string, taskId: string): string | null {
	try {
		return currentRunId(root, taskId);
	} catch {
		return null;
	}
}

async function approveEnroll(root: string, input: ApproveArgs, actorId: string, confirmationRef: string): Promise<KernelCommandResult> {
	const taskId = input.task_id;
	// The sidecar itself is checked first: an untracked TaskIntent is a
	// planning-input fault, not an Enrollment rejection.
	const sidecar = intentSidecarPath(taskId);
	if (existsSync(resolve(root, sidecar)) && !gitTracked(root, sidecar))
		return errorResult("intent_untracked", `planning inputs must be Git-tracked before approval: ${sidecar}`, 1);
	let read: ReturnType<typeof readTaskIntent>;
	try {
		read = readTaskIntent(root, taskId);
	} catch (error) {
		return errorResult("enrollment_rejected", errorMessage(error), 1);
	}
	const spec = inspectSpecBinding(read.intent);
	const required = [read.intent_ref.path, ...(spec.ok && spec.binding ? [spec.binding.active] : [])];
	const untracked = required.filter((path) => !gitTracked(root, path));
	if (untracked.length > 0)
		return errorResult("intent_untracked", `planning inputs must be Git-tracked before approval: ${untracked.join(", ")}`, 1);
	const now = new Date().toISOString();
	try {
		const preparation = preparePiCanary(root, { task_id: taskId, now });
		if (!preparation.intent) return errorResult("enrollment_rejected", "enrollment requires a readable TaskIntent", 1);
		const result = await enrollTask(root, createEnrollmentAuthorityRegistry(), {
			binding: {
				task_id: taskId,
				intent_path: preparation.intent.path,
				intent_revision: preparation.intent.revision,
				intent_content_hash: preparation.intent.content_hash,
				preparation_digest: preparation.digest,
				actor_id: actorId,
				confirmation_ref: confirmationRef,
				nonce: randomUUID(),
			},
			now,
			confirmation: { source: "external_approval", external_approval_enabled: true },
		});
		return jsonResult({
			contract: APPROVAL_RESULT_CONTRACT,
			action: "enroll",
			task_id: taskId,
			run_id: runIdForTask(root, taskId),
			lifecycle: result.record.lifecycle,
			intent_content_hash: result.record.intent_ref.content_hash,
			git_base_head: result.record.git_base_head ?? null,
			confirmation_source: result.record.confirmation_source ?? null,
		});
	} catch (error) {
		return errorResult("enrollment_rejected", errorMessage(error), 1);
	}
}

async function approveRunOperation(root: string, input: ApproveArgs, actorId: string, confirmationRef: string): Promise<KernelCommandResult> {
	const taskId = input.task_id;
	const rejected = input.mode === "stop" ? "stop_rejected" : "decision_resolution_rejected";
	const claim = readBackendClaim(root);
	if (!claim || claim.task_id !== taskId || claim.lifecycle_status !== "active")
		return errorResult("no_active_claim", `task ${taskId} has no active backend claim`, 1);
	try {
		recoverKernelStoreFollowUps(root, taskId);
		const record = readTaskRecordRaw(root, taskId).record;
		if (!record) return errorResult("no_active_claim", `task ${taskId} has no TaskRecord`, 1);
		const priorIntent = readTaskIntent(root, taskId, record.intent_ref.path, record.intent_snapshot);
		const projected = await projectAssurance(root, taskId);
		if (projected.error) return errorResult(rejected, projected.error, 1);
		const projection = projected.projection;
		const now = new Date().toISOString();
		const op = input.mode === "stop" ? "stop" : "resolve_user_decision";
		const payload = op === "stop"
			? { reason: input.reason! }
			: { finding_id: input.finding_id!, resolution: input.resolution! };
		const action = capabilityActionFor({ op, task_id: taskId, at: now, actor_id: actorId, ...payload });
		const registry = createMutationAuthorityRegistry();
		const app = createCanaryApplication(registry);
		const binding: CapabilityBindingV2 = {
			authority_kind: "user",
			task_id: taskId,
			...(projection.run_id ? { run_id: projection.run_id } : {}),
			action_digest: digestOfAction(action),
			expected_record_hash: projection.record_revision,
			intent_revision: projection.intent_revision,
			intent_content_hash: projection.intent_content_hash,
			diff_hash: projection.diff_hash,
			actor_id: actorId,
			confirmation_ref: confirmationRef,
			findings_digest: null,
		};
		const capability = registry.issue(binding);
		const result = app.execute({
			root,
			task_id: taskId,
			operation: { op, capability, actor_id: actorId, ...payload } as never,
			prior_intent_token: priorIntent.token,
			now,
		});
		if (op === "stop" || input.resolution === "accept_verifier_dispute")
			stagePlanningArtifactTransition(root, result.record);
		if (op === "stop")
			return jsonResult({
				contract: APPROVAL_RESULT_CONTRACT,
				action: "stop",
				task_id: taskId,
				run_id: projection.run_id,
				lifecycle: result.record.lifecycle,
				audit_dir: projection.run_id ? auditRunDirPath(taskId, projection.run_id) : null,
			});
		return jsonResult({
			contract: APPROVAL_RESULT_CONTRACT,
			action: "resolve_user_decision",
			task_id: taskId,
			run_id: projection.run_id,
			lifecycle: result.record.lifecycle,
			finding_id: input.finding_id,
			resolution: input.resolution,
		});
	} catch (error) {
		return errorResult(rejected, errorMessage(error), 1);
	}
}

/**
 * `imm-kernel approve <task-id> [--finding <id> --resolution <text> | --stop <reason>] [--actor <id>] --json`.
 * Async (Enrollment is), so it is exported beside the synchronous
 * `runKernelCommand` instead of changing that function's contract.
 */
export async function runKernelApproveCommand(args: string[], root = process.cwd()): Promise<KernelCommandResult> {
	const parsed = parseApproveArgs(args);
	if (typeof parsed === "string") return errorResult("invalid_command", parsed, 2);
	let enabled = false;
	try {
		enabled = resolveConfig(root).external_approval.value === true;
	} catch {
		enabled = false;
	}
	if (!enabled)
		return errorResult(
			"external_approval_disabled",
			"imm-kernel approve requires external_approval: true in the effective v2 configuration",
			1,
		);
	const layout = inspectStorageLayout(root);
	if (layout.layout !== "ready")
		return errorResult("layout_not_ready", layout.reason ?? `storage layout is ${layout.layout}`, 1);
	const actorId = parsed.actor !== null ? canonicalActorId(parsed.actor) : LITERAL_USER_ACTOR_ID;
	const confirmationRef = parsed.actor !== null ? `external_approval:${actorId}` : "external_approval";
	if (parsed.mode === "enroll") return approveEnroll(root, parsed, actorId, confirmationRef);
	return approveRunOperation(root, parsed, actorId, confirmationRef);
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
