/**
 * State Ledger transitions, review gate state, and runtime status helpers.
 */
import {
	appendFileSync,
	closeSync,
	existsSync,
	fsyncSync,
	lstatSync,
	mkdirSync,
	openSync,
	readFileSync,
	realpathSync,
	readdirSync,
	renameSync,
	rmdirSync,
	statSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import type { NormalizedPlan, WorkflowProfile } from "./plan_core";
import { compounderPolicyForTask, workflowProfileForTask } from "./plan_core";
import { stableStringify } from "./canonical_json";
import {
	AUTHORITY_OBSERVATION_GENERATION_V2,
	authorityStatePathIdentity,
	prepareAuthorityCommit,
	recoverAuthorityCommitReceipts,
	terminalizeAuthorityCommit,
	type AuthorityCommitReceipt,
	type PreparedAuthorityCommit,
} from "./authority_commit_receipts";
import {
	buildAuthorityObservationSeedV2,
	replayMissingAutomaticObservationsV2BestEffort,
	type CommittedLedgerReceipt,
} from "./kernel/observation";

export const STEP_STATES = [
	"pending",
	"active",
	"probing",
	"executing",
	"ready_for_review",
	"closed",
	"rework_needed",
	"replanning",
] as const;

export type StepState = (typeof STEP_STATES)[number];

export const VALID_TRANSITIONS: Record<string, Set<string>> = {
	pending: new Set(["active"]),
	active: new Set(["probing", "executing", "replanning"]),
	probing: new Set(["executing", "replanning"]),
	executing: new Set(["ready_for_review", "replanning"]),
	ready_for_review: new Set(["closed", "rework_needed", "replanning"]),
	rework_needed: new Set(["executing", "replanning"]),
	closed: new Set(),
	replanning: new Set(),
};

export const ACTIVE_STATES = new Set([
	"active",
	"probing",
	"executing",
	"ready_for_review",
	"rework_needed",
]);

const EXECUTION_STATUSES = new Set(["passed", "failed", "blocked"]);

type ExecutionStatus = "passed" | "failed" | "blocked";

type VerificationCheck = {
	kind: "command" | "manual";
	command: string;
	status: ExecutionStatus;
	exit_code: number | null;
	summary: string;
	artifact?: string;
};

export function utcNow(): string {
	return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

export function normalizeChangedFiles(value: unknown): string[] {
	if (Array.isArray(value)) {
		return value
			.map((p) => (typeof p === "string" ? p.trim() : ""))
			.filter((p) => p.length > 0);
	}
	if (typeof value === "string") {
		return value
			.split(",")
			.map((p) => p.trim())
			.filter((p) => p.length > 0);
	}
	return [];
}

function parseExecutionStatus(value: unknown, field: string): ExecutionStatus {
	if (typeof value !== "string" || !EXECUTION_STATUSES.has(value)) {
		throw new Error(`${field} must be passed, failed, or blocked.`);
	}
	return value as ExecutionStatus;
}

function normalizeVerificationChecks(value: unknown): VerificationCheck[] {
	if (!Array.isArray(value))
		throw new Error("structured execution evidence requires checks[].");
	return value.map((raw, index) => {
		if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
			throw new Error(`checks[${index}] must be an object.`);
		}
		const check = raw as Record<string, unknown>;
		const kind = check.kind === undefined ? "command" : check.kind;
		if (kind !== "command" && kind !== "manual")
			throw new Error(`checks[${index}].kind must be command or manual.`);
		const command =
			typeof check.command === "string" ? check.command.trim() : "";
		const summary =
			typeof check.summary === "string" ? check.summary.trim() : "";
		const status = parseExecutionStatus(
			check.status,
			`checks[${index}].status`,
		);
		const exitCode = check.exit_code === null ? null : check.exit_code;
		if (!command) throw new Error(`checks[${index}].command is required.`);
		if (!summary) throw new Error(`checks[${index}].summary is required.`);
		if (
			exitCode !== null &&
			(!Number.isInteger(exitCode) || Number(exitCode) < 0)
		) {
			throw new Error(
				`checks[${index}].exit_code must be a non-negative integer or null.`,
			);
		}
		if (kind === "command" && status === "passed" && exitCode !== 0) {
			throw new Error(
				`checks[${index}] command cannot pass without exit_code 0.`,
			);
		}
		if (kind === "manual" && exitCode !== null) {
			throw new Error(`checks[${index}] manual check must use exit_code null.`);
		}
		if (status === "failed" && exitCode === 0) {
			throw new Error(`checks[${index}] cannot fail with exit_code 0.`);
		}
		if (status === "blocked" && exitCode !== null) {
			throw new Error(`checks[${index}] must use exit_code null when blocked.`);
		}
		const normalized: VerificationCheck = {
			kind,
			command,
			status,
			exit_code: exitCode as number | null,
			summary,
		};
		if (typeof check.artifact === "string" && check.artifact.trim())
			normalized.artifact = check.artifact.trim();
		return normalized;
	});
}

/**
 * Stable failure-exit reasons. QA routes on these, so they stay a closed enum
 * rather than free-form notes that a later reader has to re-interpret.
 */
const FAILURE_EXITS = [
	"repeated same error",
	"tool failure",
	"no progress",
	"missing credentials",
	"unclear target or verification",
] as const;

export type FailureExit = (typeof FAILURE_EXITS)[number];

function parseFailureExit(value: unknown): FailureExit | null {
	if (value === undefined || value === null) return null;
	if (
		typeof value !== "string" ||
		!FAILURE_EXITS.includes(value as FailureExit)
	) {
    throw new Error(`failure_exit must be one of ${FAILURE_EXITS.join(", ")}.`);
	}
	return value as FailureExit;
}

function deriveExecutionStatus(checks: VerificationCheck[]): ExecutionStatus {
	if (checks.some((check) => check.status === "failed")) return "failed";
	if (checks.some((check) => check.status === "blocked")) return "blocked";
	return "passed";
}

export function normalizeExecutionEvidence(
	evidence: unknown,
): Record<string, unknown> {
	if (
		typeof evidence !== "object" ||
		evidence === null ||
		Array.isArray(evidence)
	) {
		throw new Error("ready_for_review pre-check requires execution evidence.");
	}
	const ev = evidence as Record<string, unknown>;
	if (
		(ev.evidence_schema !== undefined &&
			ev.evidence_schema !== "structured-v1") ||
		Object.hasOwn(ev, "verification_result") ||
		Object.hasOwn(ev, "verification_command")
	) {
		throw new Error(
			"Legacy execution evidence is not accepted by the current runtime; run imm-migrate.",
		);
	}
	if (!Object.hasOwn(ev, "checks") || !Object.hasOwn(ev, "status")) {
		throw new Error(
			"Structured execution evidence requires status and checks.",
		);
	}
	const checks = normalizeVerificationChecks(ev.checks);
	const status = parseExecutionStatus(ev.status, "status");
	const failureExit = parseFailureExit(ev.failure_exit);
	if (failureExit && status === "passed") {
    throw new Error(
      "failure_exit cannot accompany passing execution evidence.",
    );
	}
	const normalized: Record<string, unknown> = {
		...ev,
		evidence_schema: "structured-v1",
		changed_files: normalizeChangedFiles(ev.changed_files),
		checks,
		status,
		notes: typeof ev.notes === "string" ? ev.notes : "",
	};
	if (failureExit) normalized.failure_exit = failureExit;
	else delete normalized.failure_exit;
	return normalized;
}

export function validateReadyForReviewEvidence(
	evidence: unknown,
): Record<string, unknown> {
	const ev = normalizeExecutionEvidence(evidence);
	const changedFiles = ev.changed_files;
	if (
		!Array.isArray(changedFiles) ||
		!changedFiles.some((p) => typeof p === "string" && p.trim())
	) {
		throw new Error(
			'ready_for_review pre-check requires changed files. Use --changed-files "path/to/file" or provide JSON evidence with changed_files.',
		);
	}
	const checks = ev.checks as VerificationCheck[];
	if (checks.length === 0)
		throw new Error(
			"structured execution evidence requires at least one check.",
		);
	const derived = deriveExecutionStatus(checks);
	if (ev.status !== derived)
		throw new Error(
			`execution evidence status ${ev.status} does not match checks status ${derived}.`,
		);
	return ev;
}

export function transitionStep(
	state: Record<string, any>,
	stepNumber: number,
	targetState: string,
): Record<string, any> {
	const key = String(stepNumber);
	const steps = state.steps;
	if (!steps || !(key in steps)) {
		throw new Error(`Step ${stepNumber} does not exist in the state ledger.`);
	}
	const current = steps[key].state;
	const allowed = VALID_TRANSITIONS[current] || new Set<string>();
	if (!allowed.has(targetState)) {
		const allowedStr = JSON.stringify([...allowed].sort());
		throw new Error(
			`Illegal transition for step ${stepNumber}: ${current} -> ${targetState}. Allowed: ${allowedStr}`,
		);
	}
	steps[key].state = targetState;
	return state;
}

export function beginWorkProbes(
	state: Record<string, any>,
	stepNumber: number,
): Record<string, any> {
	const step = state.steps?.[String(stepNumber)];
  if (!step)
    throw new Error(`Step ${stepNumber} does not exist in the state ledger.`);
	if (step.state === "probing") return state;
	if (step.state !== "active") {
		throw new Error(
			`Cannot begin work probes on step ${stepNumber} in state '${step.state}'.`,
		);
	}
  if (
    !Array.isArray(step.parallel_probes) ||
    step.parallel_probes.length === 0
  ) {
		throw new Error(`Step ${stepNumber} has no parallel_probes.`);
	}
	if (step.child_evidence !== undefined) {
		throw new Error(
			`Step ${stepNumber} already has child_evidence before the probe checkpoint.`,
		);
	}
	transitionStep(state, stepNumber, "probing");
	state.history = [
		...(state.history || []),
		{
			at: utcNow(),
			action: "begin_work_probes",
			details: {
				step_number: stepNumber,
				step_id: step.step_id ?? null,
				probe_count: step.parallel_probes.length,
			},
		},
	];
	return state;
}

export function recordWorkProbeEvidence(
	state: Record<string, any>,
	stepNumber: number,
	childEvidence: Array<Record<string, unknown>>,
): Record<string, any> {
	const step = state.steps?.[String(stepNumber)];
  if (!step)
    throw new Error(`Step ${stepNumber} does not exist in the state ledger.`);
	if (step.state !== "probing") {
		throw new Error(
			`Cannot record work probes on step ${stepNumber} in state '${step.state}'.`,
		);
	}
	if (!Array.isArray(childEvidence) || childEvidence.length === 0) {
		throw new Error("Work probe child_evidence must be a non-empty list.");
	}
	if (step.child_evidence !== undefined) {
    throw new Error(
      `Step ${stepNumber} already has work probe child_evidence.`,
    );
	}
	step.child_evidence = structuredClone(childEvidence);
	transitionStep(state, stepNumber, "executing");
	state.history = [
		...(state.history || []),
		{
			at: utcNow(),
			action: "record_work_probe_evidence",
			details: {
				step_number: stepNumber,
				step_id: step.step_id ?? null,
				probe_ids: childEvidence.map((item) => item.probe_id ?? null),
			},
		},
	];
	return state;
}

export function recoverWorkProbeEvidence(
	state: Record<string, any>,
	stepNumber: number,
): Record<string, any> {
	const step = state.steps?.[String(stepNumber)];
  if (!step)
    throw new Error(`Step ${stepNumber} does not exist in the state ledger.`);
	if (step.state !== "probing") {
		throw new Error(
			`Cannot recover work probes on step ${stepNumber} in state '${step.state}'.`,
		);
	}
	if (!Array.isArray(step.child_evidence) || step.child_evidence.length === 0) {
    throw new Error(
      `Step ${stepNumber} has no work probe evidence to recover.`,
    );
	}
	transitionStep(state, stepNumber, "executing");
	state.history = [
		...(state.history || []),
		{
			at: utcNow(),
			action: "recover_work_probe_evidence",
			details: {
				step_number: stepNumber,
				step_id: step.step_id ?? null,
				probe_ids: step.child_evidence.map(
					(item: Record<string, unknown>) => item.probe_id ?? null,
				),
			},
		},
	];
	return state;
}

export function getCompletedSteps(state: Record<string, any>): number[] {
	const steps = state.steps || {};
	return Object.entries(steps)
		.filter(([, value]) => (value as Record<string, any>).state === "closed")
		.map(([key]) => Number(key))
		.sort((a, b) => a - b);
}

export function getActiveSteps(state: Record<string, any>): number[] {
	const steps = state.steps || {};
	return Object.entries(steps)
		.filter(([, value]) =>
			ACTIVE_STATES.has((value as Record<string, any>).state),
		)
		.map(([key]) => Number(key))
		.sort((a, b) => a - b);
}

export function activateStep(
	state: Record<string, any>,
	stepNumber: number,
	stepData: Record<string, any>,
): Record<string, any> {
	const active = getActiveSteps(state);
	if (active.length > 0 && !active.includes(stepNumber)) {
		throw new Error(
			`Step ${active[0]} is already active. Resolve it before activating another step.`,
		);
	}
	const key = String(stepNumber);
	const steps = state.steps || {};
	if (!(key in steps)) {
		steps[key] = {
			step_id: stepData.step_id,
			state: "pending",
			result: stepData.result,
			verification: stepData.verification,
		};
	}
	if (steps[key].state === "active") return state;

	// A Plan declares its own execution order; without this the order is only a
	// hint used to recommend the next Step, and any Step can be started first.
	const completed = getCompletedSteps(state);
	const unmet = (
		Array.isArray(stepData.depends_on) ? stepData.depends_on : []
	).filter((dependency: number) => !completed.includes(dependency));
	if (unmet.length > 0) {
		throw new Error(
			`Step ${stepNumber} has unmet dependencies: ${unmet.join(", ")}`,
		);
	}

	transitionStep(state, stepNumber, "active");
	steps[key].activated_at = utcNow();
	state.history = [
		...(state.history || []),
		{
			at: steps[key].activated_at,
			action: "activate_step",
			details: {
				step_number: stepNumber,
				step_id: stepData.step_id,
				plan_path: state.plan_path ?? null,
			},
		},
	];
	steps[key].result = stepData.result || steps[key].result;
	steps[key].verification = stepData.verification || steps[key].verification;
	steps[key].scope = stepData.scope || steps[key].scope || [];
	steps[key].step_id = stepData.step_id || steps[key].step_id;
	steps[key].discovery_cache =
		stepData.discovery_cache || steps[key].discovery_cache || [];
	steps[key].parallel_probes =
		stepData.parallel_probes || steps[key].parallel_probes || [];
	steps[key].test_scenarios =
		stepData.test_scenarios || steps[key].test_scenarios;
	steps[key].agent_hint = stepData.agent_hint || steps[key].agent_hint;
	steps[key].depends_on = stepData.depends_on || steps[key].depends_on || [];
	return state;
}

export function recordExecution(
	state: Record<string, any>,
	stepNumber: number,
	evidence: Record<string, unknown>,
	childEvidence?: unknown,
): Record<string, any> {
	const validated = validateReadyForReviewEvidence(evidence);
	const key = String(stepNumber);
	const steps = state.steps || {};
	if (!(key in steps)) {
		throw new Error(`Step ${stepNumber} does not exist in the state ledger.`);
	}
	const current = steps[key].state;
	const plannedProbes = Array.isArray(steps[key].parallel_probes)
		? steps[key].parallel_probes
		: [];
	if (plannedProbes.length > 0 && current !== "rework_needed") {
		if (current === "active" || current === "probing") {
			throw new Error(
				`Step ${stepNumber} has unconsumed parallel_probes; run imm-work continue and record-probes first.`,
			);
		}
		if (
			current === "executing" &&
			(!Array.isArray(steps[key].child_evidence) ||
				steps[key].child_evidence.length === 0)
		) {
			throw new Error(
				`Step ${stepNumber} has no committed work probe evidence.`,
			);
		}
	}
	if (!["active", "probing", "rework_needed", "executing"].includes(current)) {
		throw new Error(
			`Cannot record execution on step ${stepNumber} in state '${current}'.`,
		);
	}
	if (["active", "probing", "rework_needed"].includes(current)) {
		transitionStep(state, stepNumber, "executing");
	}
	const evidencePayload = { ...validated };
	const inlineChildEvidence = (evidencePayload as Record<string, unknown>)
		.child_evidence;
	let childEv: unknown = childEvidence;
	if (childEvidence === undefined) childEv = inlineChildEvidence;
	if (childEv !== undefined && !Array.isArray(childEv)) {
		throw new Error("child_evidence must be a list when provided.");
	}
	appendExecutionAttempt(steps[key], evidencePayload);
	if (childEv !== undefined) steps[key].child_evidence = childEv;
	steps[key].state = "ready_for_review";
	state.history = [
		...(state.history || []),
		{
			at: utcNow(),
			action: "record_execution_evidence",
			details: {
				step_number: stepNumber,
				step_id: steps[key].step_id ?? null,
				changed_files: Array.isArray(validated.changed_files)
					? validated.changed_files
					: [],
			},
		},
	];
	return state;
}

function appendExecutionAttempt(
	target: Record<string, any>,
	evidence: Record<string, unknown>,
): void {
	const attempts = Array.isArray(target.execution_attempts)
		? [...target.execution_attempts]
		: [];
	if (
		attempts.length === 0 &&
		target.execution_evidence &&
		typeof target.execution_evidence === "object" &&
		!Array.isArray(target.execution_evidence)
	) {
		attempts.push(structuredClone(target.execution_evidence));
	}
	const latest = structuredClone(evidence);
	attempts.push(latest);
	target.execution_attempts = attempts;
	target.execution_evidence = latest;
}

function requirePassingExecutionEvidence(evidence: unknown): void {
	let ev: Record<string, unknown>;
	try {
		ev = validateReadyForReviewEvidence(evidence);
	} catch (error) {
		throw new Error(
			`QA pass requires valid structured execution evidence: ${error instanceof Error ? error.message : error}`,
		);
	}
	if (ev.status !== "passed") {
		throw new Error(
			`QA pass requires passed execution evidence; received ${ev.status}.`,
		);
	}
}

export function reviewPass(
	state: Record<string, any>,
	stepNumber: number,
): Record<string, any> {
	requirePassingExecutionEvidence(
		state.steps?.[String(stepNumber)]?.execution_evidence,
	);
	transitionStep(state, stepNumber, "closed");
	state.steps[String(stepNumber)].closed_at = utcNow();
	return state;
}

export function reviewRework(
	state: Record<string, any>,
	stepNumber: number,
): Record<string, any> {
	transitionStep(state, stepNumber, "rework_needed");
	return state;
}

export function reviewReplan(
	state: Record<string, any>,
	stepNumber: number,
): Record<string, any> {
	transitionStep(state, stepNumber, "replanning");
	state.requires_replan = true;
	return state;
}

// ── state ledger load/save ──────────────────────────────────────────

export type FollowUpState =
	| "pending"
	| "executing"
	| "ready_for_review"
	| "rework_needed"
	| "closed"
	| "replanning";

export interface FollowUpRecord {
	id: string;
	state: FollowUpState;
	scope: string[];
	change_goal: string;
	verification_hint: string;
	origin_review: {
		gate: "imm-code-review" | "imm-ui-review";
		evidence_ref: string;
	};
	execution_evidence: Record<string, unknown> | null;
	execution_attempts?: Array<Record<string, unknown>>;
	opened_at: string;
	round: number;
	qa_decision?: Record<string, unknown>;
	closed_at?: string;
	archive?: {
		reason: string;
		authority: "user";
		archived_at: string;
	};
}

export interface OpenFollowUpInput {
	boundary: string;
	scope: unknown;
	change_goal: string;
	verification_hint: string;
	origin_gate: string;
	evidence_ref: string;
	changed_files_signature?: string;
}

export type PlanTerminalStatus = "cancelled" | "superseded";

export type PlanTerminationReasonCode =
	| "exploration_gap"
	| "scope_pivot"
	| "boundary_error"
	| "contract_change"
	| "execution_failure";

export const PLAN_TERMINATION_REASON_CODES = new Set<PlanTerminationReasonCode>(
  [
	"exploration_gap",
	"scope_pivot",
	"boundary_error",
	"contract_change",
	"execution_failure",
  ],
);

export interface PlanTerminationObservability {
	reason_code?: PlanTerminationReasonCode;
	stage?: string;
	invalidated_assumption?: string;
	avoidable?: boolean;
}

export interface PlanTerminationRecord {
	termination_id: string;
	status: PlanTerminalStatus;
	reason: string;
	authority: "user";
	terminated_at: string;
	plan_path: string;
	plan_signature: string | null;
	execution_contract_signature: string | null;
	validated_plan_snapshot: unknown;
	steps: Record<string, unknown>;
	pending_follow_up: unknown;
	review_state: unknown;
	last_review: unknown;
	reason_code?: PlanTerminationReasonCode;
	stage?: string;
	invalidated_assumption?: string;
	avoidable?: boolean;
}

export type RoadmapPhaseCompletionProvenance =
	| "runtime_finish"
	| "signed_history_migration";

export interface RoadmapPhaseCompletionRecord {
	contract: "roadmap_phase_completion/v1";
	completion_id: string;
	plan_path: string;
	plan_signature: string;
	roadmap_source: string;
	phase: string;
	finished_at: string;
	provenance: RoadmapPhaseCompletionProvenance;
}

export interface BuildRoadmapPhaseCompletionInput {
	plan_path: string;
	plan_signature: string;
	roadmap_source: string;
	phase: string;
	finished_at: string;
	provenance: RoadmapPhaseCompletionProvenance;
}

export interface StateLedger {
	schema_version: 3;
	steps: Record<string, any>;
	pending_follow_up: unknown;
	last_review: unknown;
	validated_plan_snapshot: unknown;
	history: Array<Record<string, unknown>>;
	requires_replan: boolean;
	runtime_status: string;
	closed_plan_history: Array<Record<string, unknown>>;
	plan_transition_history: Array<Record<string, unknown>>;
	roadmap_phase_completion_history: Array<RoadmapPhaseCompletionRecord>;
	plan_termination_history: Array<PlanTerminationRecord>;
	plan_terminal: PlanTerminationRecord | null;
	[key: string]: unknown;
}

export function createEmptyStateLedger(): StateLedger {
	return {
		schema_version: 3,
		steps: {},
		pending_follow_up: null,
		last_review: null,
		validated_plan_snapshot: null,
		history: [],
		requires_replan: false,
		runtime_status: "idle",
		closed_plan_history: [],
		plan_transition_history: [],
		roadmap_phase_completion_history: [],
		plan_termination_history: [],
		plan_terminal: null,
	};
}

function taskSnapshot(state: Record<string, any>): Record<string, string> {
	const snapshot = state.validated_plan_snapshot;
	if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot))
		return {};
	const task = snapshot.task;
	if (!task || typeof task !== "object" || Array.isArray(task)) return {};
	return Object.fromEntries(
		Object.entries(task).filter(
			(entry): entry is [string, string] => typeof entry[1] === "string",
		),
	);
}

function normalizedPlanIdentityField(value: string): string | null {
	const trimmed = value.trim();
	if (!trimmed || trimmed.includes("\0")) return null;
	if (!trimmed.includes("`")) return trimmed;
	const codeSpan = /^`([^`\r\n]+)`$/.exec(trimmed);
	return codeSpan ? codeSpan[1].trim() : null;
}

function buildPlanTerminationId(
	record: Omit<PlanTerminationRecord, "termination_id">,
): string {
	return createHash("sha256")
		.update(
			"immune-brain-plan-termination-v1\0" +
				stableStringify({ termination_id: "", ...record }),
		)
		.digest("hex");
}

export function isAuthorizedSupersededReplacement(
	state: Record<string, any>,
	projectRoot: string,
): boolean {
	const task = taskSnapshot(state);
	const predecessor = task.superseded_predecessor;
	const currentPlan = state.plan_path;
	const history = state.plan_termination_history;
	if (
		!predecessor ||
		typeof currentPlan !== "string" ||
		!currentPlan ||
		!Array.isArray(history) ||
		history.length === 0
	) {
		return false;
	}
	const latest = history.at(-1);
	if (
		!latest ||
		typeof latest !== "object" ||
		latest.status !== "superseded" ||
		latest.authority !== "user" ||
		typeof latest.plan_path !== "string"
	) {
		return false;
	}
	const { termination_id: terminationId, ...terminationPayload } =
		latest as PlanTerminationRecord;
	if (
		terminationId !==
		buildPlanTerminationId(
			terminationPayload as Omit<PlanTerminationRecord, "termination_id">,
		)
	) {
		return false;
	}
	try {
		const predecessorPath = normalizedPlanIdentityField(predecessor);
		if (!predecessorPath) return false;
		const currentIdentity = canonicalizeTrustedPlanIdentity(
			currentPlan,
			projectRoot,
		);
		const predecessorIdentity = canonicalizeTrustedPlanIdentity(
			predecessorPath,
			projectRoot,
		);
		const terminatedIdentity = canonicalizeTrustedPlanIdentity(
			latest.plan_path,
			projectRoot,
		);
		return (
			currentIdentity !== predecessorIdentity &&
			predecessorIdentity === terminatedIdentity
		);
	} catch {
		return false;
	}
}

export function workflowProfileForState(
	state: Record<string, any>,
): WorkflowProfile {
	return workflowProfileForTask(taskSnapshot(state));
}

export interface FollowUpBudgetState {
	profile: WorkflowProfile;
	current: number;
	limit: number | null;
	remaining: number | null;
	budget_stop: boolean;
}

export function followUpBudgetState(
	state: Record<string, any>,
): FollowUpBudgetState {
	const profile = workflowProfileForState(state);
	const history = Array.isArray(state.follow_up_history)
		? state.follow_up_history
		: [];
	const startIndex = Number.isInteger(state.review_follow_up_start_index)
		? Math.max(0, Math.min(state.review_follow_up_start_index, history.length))
		: 0;
	const current = history.length - startIndex;
	if (profile !== "standard") {
		return {
			profile,
			current,
			limit: null,
			remaining: null,
			budget_stop: false,
		};
	}
	const limit = 2;
	return {
		profile,
		current,
		limit,
		remaining: Math.max(0, limit - current),
		budget_stop: current >= limit,
	};
}

export function compounderRequirement(
	state: Record<string, any>,
	changedFiles: string[],
): { required: boolean; reasons: string[] } {
	if (workflowProfileForState(state) === "strict") {
		return { required: true, reasons: ["strict_profile"] };
	}
	const reasons: string[] = [];
	if (compounderPolicyForTask(taskSnapshot(state)) === "required") {
		reasons.push("plan_required");
	}
	if (followUpBudgetState(state).current >= 2) {
		reasons.push("multiple_follow_ups");
	}
	if (
		changedFiles.some(
			(path) => path === "CONTEXT.md" || path.startsWith("docs/solutions/"),
		)
	) {
		reasons.push("durable_learning_surface_changed");
	}
	return { required: reasons.length > 0, reasons };
}

const ROADMAP_PHASE_COMPLETION_ID_DOMAIN =
	"immune-brain/roadmap-phase-completion/v1\0";
const ROADMAP_PHASE_COMPLETION_TEXT_LIMIT = 512;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const UTC_SECOND_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

function normalizeRoadmapCompletionText(value: unknown, label: string): string {
	if (typeof value !== "string" || value.includes("\0")) {
		throw new Error(`Roadmap Phase completion ${label} must be a string.`);
	}
	const normalized = value.replace(/\s+/g, " ").trim();
	if (!normalized || normalized.length > ROADMAP_PHASE_COMPLETION_TEXT_LIMIT) {
		throw new Error(
			`Roadmap Phase completion ${label} must be a non-empty bounded string.`,
		);
	}
	return normalized;
}

function normalizeRoadmapCompletionPlanPath(value: unknown): string {
	const path = normalizeRoadmapCompletionText(value, "plan_path");
	const parts = path.split("/");
	if (
		path !== value ||
		path.startsWith("/") ||
		/^[A-Za-z]:/.test(path) ||
		path.includes("\\") ||
		!path.endsWith(".md") ||
		parts.some((part) => !part || part === "." || part === "..")
	) {
		throw new Error(
			"Roadmap Phase completion plan_path must be a canonical project-relative Markdown path.",
		);
	}
	return path;
}

function normalizeRoadmapCompletionTimestamp(value: unknown): string {
	const parsed = typeof value === "string" ? new Date(value) : null;
	if (
		typeof value !== "string" ||
		!UTC_SECOND_PATTERN.test(value) ||
		!parsed ||
		Number.isNaN(parsed.getTime()) ||
		parsed.toISOString().replace(".000Z", "Z") !== value
	) {
		throw new Error(
			"Roadmap Phase completion finished_at must be an ISO 8601 UTC timestamp.",
		);
	}
	return value;
}

export function buildRoadmapPhaseCompletionRecord(
	input: BuildRoadmapPhaseCompletionInput,
): RoadmapPhaseCompletionRecord {
	const planPath = normalizeRoadmapCompletionPlanPath(input.plan_path);
	if (!SHA256_PATTERN.test(input.plan_signature)) {
		throw new Error(
			"Roadmap Phase completion plan_signature must be a SHA-256 digest.",
		);
	}
	const roadmapSource = normalizeRoadmapCompletionText(
		input.roadmap_source,
		"roadmap_source",
	);
	const phase = normalizeRoadmapCompletionText(input.phase, "phase");
	const finishedAt = normalizeRoadmapCompletionTimestamp(input.finished_at);
	if (
		input.provenance !== "runtime_finish" &&
		input.provenance !== "signed_history_migration"
	) {
		throw new Error("Roadmap Phase completion provenance is invalid.");
	}
	const identity = {
		plan_path: planPath,
		plan_signature: input.plan_signature,
		roadmap_source: roadmapSource,
		phase,
		finished_at: finishedAt,
	};
	return {
		contract: "roadmap_phase_completion/v1",
		completion_id: createHash("sha256")
			.update(ROADMAP_PHASE_COMPLETION_ID_DOMAIN)
			.update(stableStringify(identity))
			.digest("hex"),
		...identity,
		provenance: input.provenance,
	};
}

function validateRoadmapPhaseCompletionHistory(
	value: unknown,
): asserts value is RoadmapPhaseCompletionRecord[] {
	if (value === undefined) return;
	if (!Array.isArray(value)) {
		throw new Error(
			"schema v3 roadmap_phase_completion_history must be an array when present.",
		);
	}
	const ids = new Set<string>();
	for (const [index, record] of value.entries()) {
		if (!record || typeof record !== "object" || Array.isArray(record)) {
			throw new Error(
				`roadmap_phase_completion_history.${index} must be an object.`,
			);
		}
		const candidate = record as Record<string, unknown>;
		if (candidate.contract !== "roadmap_phase_completion/v1") {
			throw new Error(
				`roadmap_phase_completion_history.${index} has an unsupported contract.`,
			);
		}
		const expected = buildRoadmapPhaseCompletionRecord({
			plan_path: candidate.plan_path as string,
			plan_signature: candidate.plan_signature as string,
			roadmap_source: candidate.roadmap_source as string,
			phase: candidate.phase as string,
			finished_at: candidate.finished_at as string,
			provenance: candidate.provenance as RoadmapPhaseCompletionProvenance,
		});
		if (stableStringify(candidate) !== stableStringify(expected)) {
			throw new Error(
				`roadmap_phase_completion_history.${index} is not canonical or has an invalid completion_id.`,
			);
		}
		if (ids.has(expected.completion_id)) {
			throw new Error(
				`Duplicate completion_id '${expected.completion_id}' in roadmap_phase_completion_history.`,
			);
		}
		ids.add(expected.completion_id);
	}
}

export function applyIntentionalFinish(
	state: Record<string, any>,
	now: string,
	source?: string,
): void {
	const snapshot = state.validated_plan_snapshot;
	const task = taskSnapshot(state);
	let completion: RoadmapPhaseCompletionRecord | null = null;
	if (
		snapshot &&
		typeof snapshot === "object" &&
		!Array.isArray(snapshot) &&
		typeof task.roadmap_source === "string" &&
		task.roadmap_source.trim() &&
		typeof task.current_phase === "string" &&
		task.current_phase.trim()
	) {
		completion = buildRoadmapPhaseCompletionRecord({
			plan_path: snapshot.plan_path,
			plan_signature: snapshot.plan_signature,
			roadmap_source: task.roadmap_source,
			phase: task.current_phase,
			finished_at: now,
			provenance: "runtime_finish",
		});
	}
	const completionHistory = Array.isArray(
		state.roadmap_phase_completion_history,
	)
		? state.roadmap_phase_completion_history
		: [];
	if (completion) {
		const existing = completionHistory.find(
			(record: RoadmapPhaseCompletionRecord) =>
				record.completion_id === completion!.completion_id,
		);
		if (existing && stableStringify(existing) !== stableStringify(completion)) {
			throw new Error(
				`Duplicate completion_id '${completion.completion_id}' has conflicting content.`,
			);
		}
		state.roadmap_phase_completion_history = existing
			? [...completionHistory]
			: [...completionHistory, completion];
	} else {
		state.roadmap_phase_completion_history = [...completionHistory];
	}

	state.runtime_status = "idle";
	state.reset_reason = "intentional_reset";
	state.active_step = null;
	state.requires_replan = false;
	state.history = [
		...(state.history || []),
		{
			at: now,
			action: "finish_reset",
			details: {
				plan_path: state.plan_path,
				...(source ? { source } : {}),
			},
		},
	];
}

export function getPlanTerminal(
	state: Record<string, any>,
): PlanTerminationRecord | null {
	const value = state.plan_terminal;
	if (
		!value ||
		typeof value !== "object" ||
		typeof value.termination_id !== "string" ||
		!value.termination_id ||
		!(["cancelled", "superseded"] as string[]).includes(value.status) ||
		value.authority !== "user" ||
		typeof value.reason !== "string" ||
		!value.reason.trim() ||
		typeof value.plan_path !== "string" ||
		!value.plan_path ||
		typeof value.terminated_at !== "string" ||
		!value.terminated_at ||
		typeof value.steps !== "object" ||
		value.steps === null ||
		Array.isArray(value.steps)
	) {
		return null;
	}
	try {
		const normalized = normalizeTerminationObservability(value);
		const hasObservability = [
			"reason_code",
			"stage",
			"invalidated_assumption",
			"avoidable",
		].some((field) => Object.hasOwn(value, field));
		if (value.status === "superseded" && hasObservability) {
			requireSupersedeObservability(normalized);
		}
	} catch {
		return null;
	}
	return value as PlanTerminationRecord;
}

const BOUNDED_TEXT_LIMIT = 512;

function normalizeBoundedText(
	value: unknown,
	label: string,
): string | undefined {
	if (value === undefined || value === null) return undefined;
	if (typeof value !== "string") {
		throw new Error(`Plan termination ${label} must be a string.`);
	}
	const normalized = value.replace(/\s+/g, " ").trim();
  if (
    !normalized ||
    normalized.length > BOUNDED_TEXT_LIMIT ||
    value.includes("\0")
  ) {
		throw new Error(
			`Plan termination ${label} must be a non-empty bounded string.`,
		);
	}
	return normalized;
}

function normalizeTerminationObservability(
	observability: PlanTerminationObservability,
): PlanTerminationObservability {
	const out: PlanTerminationObservability = {};
	if (observability.reason_code !== undefined) {
		if (!PLAN_TERMINATION_REASON_CODES.has(observability.reason_code)) {
			throw new Error(
				`Plan termination reason_code must be one of: ${[...PLAN_TERMINATION_REASON_CODES].join(", ")}.`,
			);
		}
		out.reason_code = observability.reason_code;
	}
	const stage = normalizeBoundedText(observability.stage, "stage");
	if (stage !== undefined) out.stage = stage;
	const assumption = normalizeBoundedText(
		observability.invalidated_assumption,
		"invalidated_assumption",
	);
	if (assumption !== undefined) out.invalidated_assumption = assumption;
	if (observability.avoidable !== undefined) {
		if (typeof observability.avoidable !== "boolean") {
			throw new Error("Plan termination avoidable must be a boolean.");
		}
		out.avoidable = observability.avoidable;
	}
	if (observability.reason_code === "scope_pivot" && out.avoidable === true) {
		throw new Error(
			"Plan termination scope_pivot must be classified as unavoidable.",
		);
	}
	return out;
}

function requireSupersedeObservability(
	observability: PlanTerminationObservability,
): void {
	const fields: Array<[string, unknown]> = [
		["reason_code", observability.reason_code],
		["stage", observability.stage],
		["invalidated_assumption", observability.invalidated_assumption],
		["avoidable", observability.avoidable],
	];
	const missing = fields
		.filter(([, value]) => value === undefined)
		.map(([name]) => name);
	if (missing.length > 0) {
		throw new Error(
			`Superseding a Plan requires termination observability: ${missing.join(", ")}.`,
		);
	}
}

export function terminateCurrentPlan(
	state: Record<string, any>,
	status: PlanTerminalStatus,
	reason: string,
	authority: "user",
	now: string,
	observability: PlanTerminationObservability = {},
): PlanTerminationRecord {
	if (!state.plan_path) throw new Error("No current Plan to terminate.");
	if (getPlanTerminal(state)?.plan_path === state.plan_path)
		throw new Error("Current Plan is already terminal.");
	if (status !== "cancelled" && status !== "superseded") {
		throw new Error("Plan terminal status must be cancelled or superseded.");
	}
	const normalizedReason = reason.replace(/\s+/g, " ").trim();
	if (
		!normalizedReason ||
		normalizedReason.length > 1024 ||
		reason.includes("\0")
	) {
		throw new Error(
			"Plan termination reason must be a non-empty bounded string.",
		);
	}
	const normalized = normalizeTerminationObservability(observability);
	if (status === "superseded") requireSupersedeObservability(normalized);
	const record: PlanTerminationRecord = {
		termination_id: "",
		status,
		reason: normalizedReason,
		authority,
		terminated_at: now,
		plan_path: String(state.plan_path),
		plan_signature:
			typeof state.plan_signature === "string" ? state.plan_signature : null,
		execution_contract_signature:
			typeof state.plan_execution_contract_signature === "string"
				? state.plan_execution_contract_signature
				: null,
		validated_plan_snapshot: structuredClone(
			state.validated_plan_snapshot ?? null,
		),
		steps: structuredClone(state.steps || {}),
		pending_follow_up: structuredClone(state.pending_follow_up ?? null),
		review_state: structuredClone(state.review_state ?? { gates: {} }),
		last_review: structuredClone(state.last_review ?? null),
		...normalized,
	};
	record.termination_id = buildPlanTerminationId(record);
	state.plan_termination_history = [
		...(Array.isArray(state.plan_termination_history)
			? state.plan_termination_history
			: []),
		record,
	];
	state.plan_terminal = record;
	state.steps = {};
	state.pending_follow_up = null;
	state.review_state = { gates: {} };
	state.active_step = null;
	state.next_action = null;
	state.requires_replan = false;
	state.runtime_status = "idle";
	state.reset_reason = "intentional_reset";
	state.history = [
		...(Array.isArray(state.history) ? state.history : []),
		{
			at: now,
			action: "terminate_plan",
			details: {
				termination_id: record.termination_id,
				status,
				reason: normalizedReason,
				authority,
				...normalized,
			},
		},
	];
	return record;
}

const FOLLOW_UP_STATES = new Set<FollowUpState>([
	"pending",
	"executing",
	"ready_for_review",
	"rework_needed",
	"closed",
	"replanning",
]);
const FOLLOW_UP_GATES = new Set(["imm-code-review", "imm-ui-review"]);

export function getPendingFollowUp(
	state: Record<string, any>,
): FollowUpRecord | null {
	const value = state.pending_follow_up;
	if (typeof value !== "object" || value === null || Array.isArray(value))
		return null;
	const origin = value.origin_review;
	if (
		typeof value.id !== "string" ||
		!value.id.trim() ||
		!FOLLOW_UP_STATES.has(value.state) ||
		!Array.isArray(value.scope) ||
		value.scope.length === 0 ||
		value.scope.some(
			(entry: unknown) => typeof entry !== "string" || !entry.trim(),
		) ||
		typeof value.change_goal !== "string" ||
		!value.change_goal.trim() ||
		typeof value.verification_hint !== "string" ||
		!value.verification_hint.trim() ||
		typeof origin !== "object" ||
		origin === null ||
		Array.isArray(origin) ||
		!FOLLOW_UP_GATES.has(origin.gate) ||
		typeof origin.evidence_ref !== "string" ||
		!origin.evidence_ref.trim() ||
		(value.execution_evidence !== null &&
			(typeof value.execution_evidence !== "object" ||
				Array.isArray(value.execution_evidence))) ||
		typeof value.opened_at !== "string" ||
		!value.opened_at.trim() ||
		!Number.isInteger(value.round) ||
		value.round < 1 ||
		(value.qa_decision !== undefined &&
			(typeof value.qa_decision !== "object" ||
				value.qa_decision === null ||
				Array.isArray(value.qa_decision))) ||
		(value.closed_at !== undefined &&
			(typeof value.closed_at !== "string" || !value.closed_at.trim()))
	)
		return null;
	return value as FollowUpRecord;
}

function normalizeFollowUpScope(value: unknown): string[] {
	const entries = normalizeChangedFiles(value);
	const unique = [...new Set(entries)];
	if (unique.length === 0 || unique.length > 20)
		throw new Error(
			"follow-up scope must contain 1-20 bounded paths or symbols.",
		);
	for (const entry of unique) {
		const segments = entry.split(/[\\/]/);
		if (
			entry.length > 256 ||
			entry.includes("\0") ||
			entry.includes("\n") ||
			entry.includes("*") ||
			entry.startsWith("/") ||
			/^[A-Za-z]:[\\/]/.test(entry) ||
			segments.includes("..")
		) {
			throw new Error(
				"follow-up scope must use bounded project-relative paths or symbols.",
			);
		}
	}
	return unique;
}

function requiredFollowUpText(
	value: string,
	field: string,
	maxLength: number,
): string {
	const normalized = value.trim();
	if (
		!normalized ||
		normalized.length > maxLength ||
		normalized.includes("\0") ||
		normalized.includes("\n")
	) {
		throw new Error(`follow-up ${field} must be a non-empty bounded string.`);
	}
	return normalized;
}

export function openFollowUp(
	state: Record<string, any>,
	input: OpenFollowUpInput,
): FollowUpRecord {
	if (input.boundary !== "same-boundary")
		throw new Error("Only same-boundary reviewer follow-up may be opened.");
	const budget = followUpBudgetState(state);
	if (budget.budget_stop) {
		throw new Error(
			`Standard workflow follow-up budget exhausted (${budget.current}/${budget.limit}); replan or request explicit user disposition.`,
		);
	}
	if (
		state.pending_follow_up !== null &&
		state.pending_follow_up !== undefined
	) {
		throw new Error("A pending follow-up already exists.");
	}
	if (getActiveSteps(state).length > 0)
		throw new Error("Cannot open a follow-up while a Plan Step is active.");
	if (state.requires_replan)
		throw new Error("Cannot open a follow-up while replanning is required.");

	const scope = normalizeFollowUpScope(input.scope);
	const changeGoal = requiredFollowUpText(
		input.change_goal,
		"change_goal",
		1000,
	);
	const verificationHint = requiredFollowUpText(
		input.verification_hint,
		"verification_hint",
		2000,
	);
	const evidenceRef = requiredFollowUpText(
		input.evidence_ref,
		"evidence_ref",
		512,
	);
	const gate = input.origin_gate.trim();
	if (!FOLLOW_UP_GATES.has(gate))
		throw new Error(
			"follow-up origin_gate must be imm-code-review or imm-ui-review.",
		);
	const unfinishedStep = Object.values(state.steps || {}).some(
		(step: any) => step.state !== "closed",
	);
	if (unfinishedStep)
		throw new Error("Reviewer follow-up requires all Plan Steps to be closed.");
	const changedFiles = collectReviewChangedFiles(state);
	const requiredGates = determineRequiredReviewGates(changedFiles);
	const pendingGate = requiredGates.find(
		(requiredGate) =>
			!getReviewPassForChangedFiles(state, requiredGate, changedFiles),
	);
	const changedFilesSignature = buildReviewChangedFilesSignature(changedFiles);
	const providedSignature = input.changed_files_signature?.trim() || "";
	if (pendingGate) {
		if (pendingGate !== gate)
			throw new Error(
				"follow-up origin_gate must match the current pending review gate.",
			);
		if (providedSignature && providedSignature !== changedFilesSignature) {
			throw new Error(
				"follow-up changed_files_signature must match the current review checkpoint.",
			);
		}
	} else {
		if (!requiredGates.includes(gate))
			throw new Error(
				"follow-up origin_gate is not required for the current changed files.",
			);
		if (!providedSignature)
			throw new Error(
				"follow-up changed_files_signature is required to reopen a passed review gate.",
			);
		if (providedSignature !== changedFilesSignature) {
			throw new Error(
				"follow-up changed_files_signature must match the current review checkpoint.",
			);
		}
	}
	const reopenedPass = pendingGate
		? null
		: getReviewPassForChangedFiles(state, gate, changedFiles);
	if (!pendingGate && !reopenedPass)
		throw new Error("follow-up origin_gate has no current pass to reopen.");

	const history = Array.isArray(state.follow_up_history)
		? state.follow_up_history
		: [];
	const round = history.length + 1;
	const openedAt = utcNow();
	const idSource = JSON.stringify([
		openedAt,
		round,
		gate,
		evidenceRef,
		scope,
		changeGoal,
	]);
	const followUp: FollowUpRecord = {
		id: `follow-up-${createHash("sha256").update(idSource).digest("hex").slice(0, 12)}`,
		state: "pending",
		scope,
		change_goal: changeGoal,
		verification_hint: verificationHint,
		origin_review: {
			gate: gate as FollowUpRecord["origin_review"]["gate"],
			evidence_ref: evidenceRef,
		},
		execution_evidence: null,
		opened_at: openedAt,
		round,
	};
	if (reopenedPass) delete state.review_state.gates[gate];
	state.pending_follow_up = followUp;
	state.history = [
		...(state.history || []),
		...(reopenedPass
			? [
					{
						at: openedAt,
						action: "review_gate_reopened",
						details: {
							gate,
							changed_files_signature: changedFilesSignature,
							prior_evidence_ref: reopenedPass.evidence_ref,
							finding_evidence_ref: evidenceRef,
							follow_up_id: followUp.id,
						},
					},
				]
			: []),
		{
			at: openedAt,
			action: "follow_up_open",
			details: { id: followUp.id, round, gate },
		},
	];
	return followUp;
}

function requireFollowUpTarget(
	state: Record<string, any>,
	expectedTargetId: string,
): FollowUpRecord {
	const followUp = getPendingFollowUp(state);
	if (!followUp) throw new Error("No pending follow-up.");
	if (!expectedTargetId.trim() || followUp.id !== expectedTargetId)
		throw new Error("Follow-up target ID mismatch.");
	return followUp;
}

export interface FollowUpCommitExpectation {
	id: string;
	state: FollowUpState;
	version: string;
	ledgerVersion: string;
}

function followUpVersion(followUp: FollowUpRecord): string {
	return createHash("sha256").update(JSON.stringify(followUp)).digest("hex");
}

export function captureFollowUpCommitExpectation(
	state: Record<string, any>,
	expectedTargetId: string,
): FollowUpCommitExpectation {
	const followUp = requireFollowUpTarget(state, expectedTargetId);
	return {
		id: followUp.id,
		state: followUp.state,
		version: followUpVersion(followUp),
		ledgerVersion: stateVersion(state as StateLedger),
	};
}

export function recordFollowUpExecution(
	state: Record<string, any>,
	evidence: Record<string, unknown>,
	expectedTargetId: string,
): FollowUpRecord {
	const followUp = requireFollowUpTarget(state, expectedTargetId);
	if (!["pending", "executing", "rework_needed"].includes(followUp.state)) {
		throw new Error(
			`Cannot record execution on follow-up in state '${followUp.state}'.`,
		);
	}
	followUp.state = "executing";
	appendExecutionAttempt(followUp, validateReadyForReviewEvidence(evidence));
	followUp.state = "ready_for_review";
	return followUp;
}

export function reviewFollowUp(
	state: Record<string, any>,
	decision: "pass" | "rework" | "replan",
	evidence: Record<string, unknown>,
	expectedTargetId: string,
): FollowUpRecord {
	const followUp = requireFollowUpTarget(state, expectedTargetId);
	if (followUp.state !== "ready_for_review") {
		throw new Error(
			"Follow-up QA decision requires ready_for_review execution evidence.",
		);
	}
	if (decision === "pass")
		requirePassingExecutionEvidence(followUp.execution_evidence);
	const decidedAt = utcNow();
	followUp.qa_decision = { decision, ...evidence, recorded_at: decidedAt };
	if (decision === "rework") {
		followUp.state = "rework_needed";
	} else if (decision === "replan") {
		followUp.state = "replanning";
		state.requires_replan = true;
	} else {
		followUp.state = "closed";
		followUp.closed_at = decidedAt;
		state.follow_up_history = [
			...(Array.isArray(state.follow_up_history)
				? state.follow_up_history
				: []),
			followUp,
		];
		state.last_follow_up_completion = {
			id: followUp.id,
			round: followUp.round,
			completed_at: decidedAt,
			reported_at: null,
		};
		state.pending_follow_up = null;
	}
	state.history = [
		...(state.history || []),
		{
			at: decidedAt,
			action: "review_follow_up",
			details: { id: followUp.id, round: followUp.round, decision },
		},
	];
	return followUp;
}

export function archiveFollowUp(
	state: Record<string, any>,
	targetId: string,
	reason: string,
	authority: "user",
	now: string,
): FollowUpRecord {
	const followUp = requireFollowUpTarget(state, targetId);
	if (followUp.state === "closed")
		throw new Error("Cannot archive a closed follow-up.");
	const normalizedReason = reason.trim();
	if (!normalizedReason || normalizedReason.length > 4096)
		throw new Error("Follow-up archive reason must be 1-4096 characters.");
	followUp.state = "closed";
	followUp.closed_at = now;
	followUp.archive = {
		reason: normalizedReason,
		authority,
		archived_at: now,
	};
	state.follow_up_history = [
		...(Array.isArray(state.follow_up_history) ? state.follow_up_history : []),
		followUp,
	];
	state.pending_follow_up = null;
	state.last_follow_up_archive = {
		id: followUp.id,
		round: followUp.round,
		archived_at: now,
		reason: normalizedReason,
		authority,
	};
	state.history = [
		...(state.history || []),
		{
			at: now,
			action: "archive_follow_up",
			details: {
				id: followUp.id,
				round: followUp.round,
				reason: normalizedReason,
				authority,
			},
		},
	];
	return followUp;
}

export function loadStateLedger(statePath: string): StateLedger | null {
	if (!existsSync(statePath)) return null;
	let parsed: unknown;
	try {
		parsed = JSON.parse(readFileSync(statePath, "utf-8"));
	} catch (error) {
		throw new Error(
			`State Ledger contains invalid JSON: ${error instanceof Error ? error.message : error}`,
		);
	}
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
		throw new Error("State Ledger must be a JSON object.");
	}
	return parsed as StateLedger;
}

const LEDGER_TEMP_MAX_AGE_MS = 60_000;
const LEDGER_WRITE_LOCK_FRESHNESS_GRACE_MS = 5_000;

export type LedgerWriteLockOwner = {
	runId: string;
	pid: number;
	startedAt: string;
	initializing: boolean;
};

function ledgerWriteLockPath(statePath: string): string {
	return `${statePath}.write.lock`;
}

function ledgerWriteLockOwnerPath(lockPath: string): string {
	return join(lockPath, "owner.json");
}

function readLedgerWriteLockOwner(
	lockPath: string,
): LedgerWriteLockOwner | null {
	try {
		const value = JSON.parse(
			readFileSync(ledgerWriteLockOwnerPath(lockPath), "utf-8"),
		);
		if (
			typeof value !== "object" ||
			value === null ||
			Array.isArray(value) ||
			typeof value.runId !== "string" ||
			!value.runId ||
			!Number.isInteger(value.pid) ||
			value.pid <= 0 ||
			typeof value.startedAt !== "string" ||
			!value.startedAt ||
			!Number.isFinite(Date.parse(value.startedAt)) ||
			typeof value.initializing !== "boolean"
		)
			return null;
		return value as LedgerWriteLockOwner;
	} catch {
		return null;
	}
}

function processIsAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error: any) {
		return error?.code === "EPERM";
	}
}

export type LedgerWriteLockClassification =
  "absent" | "live" | "fresh" | "malformed" | "initializing" | "stale";

export interface LedgerWriteLockInspection {
	classification: LedgerWriteLockClassification;
	lockPath: string;
	owner: LedgerWriteLockOwner | null;
}

/** Read-only diagnostics. Recovery remains an explicit operator action. */
export function inspectLedgerWriteLock(
	statePath: string,
): LedgerWriteLockInspection {
	const lockPath = ledgerWriteLockPath(statePath);
	if (!existsSync(lockPath))
		return { classification: "absent", lockPath, owner: null };
	const owner = readLedgerWriteLockOwner(lockPath);
	if (!owner) return { classification: "malformed", lockPath, owner: null };
	if (owner.initializing)
		return { classification: "initializing", lockPath, owner };
	if (processIsAlive(owner.pid))
		return { classification: "live", lockPath, owner };
	const classification =
		Date.now() - Date.parse(owner.startedAt) <
		LEDGER_WRITE_LOCK_FRESHNESS_GRACE_MS
			? "fresh"
			: "stale";
	return { classification, lockPath, owner };
}

function cleanupStaleLedgerTemps(statePath: string): void {
	const directory = dirname(statePath);
	const prefix = `.${basename(statePath)}.tmp-`;
	try {
		for (const entry of readdirSync(directory)) {
			if (!entry.startsWith(prefix)) continue;
			const path = join(directory, entry);
			try {
				if (Date.now() - statSync(path).mtimeMs > LEDGER_TEMP_MAX_AGE_MS)
					unlinkSync(path);
			} catch {
				/* another writer or cleanup won the race */
			}
		}
	} catch {
		/* ledger directory may not exist yet */
	}
}

export function withLedgerWriteLock<T>(statePath: string, write: () => T): T {
	const lockPath = ledgerWriteLockPath(statePath);
	const owner: LedgerWriteLockOwner = {
		runId: randomUUID(),
		pid: process.pid,
		startedAt: utcNow(),
		initializing: true,
	};
	try {
		mkdirSync(lockPath);
	} catch {
		throw new Error("State Ledger write is already in progress.");
	}
	const ownerPath = ledgerWriteLockOwnerPath(lockPath);
	try {
		writeFileSync(ownerPath, JSON.stringify(owner), { mode: 0o600 });
		owner.initializing = false;
		writeFileSync(ownerPath, JSON.stringify(owner), { mode: 0o600 });
		return write();
	} finally {
		try {
			const persistedOwner = readLedgerWriteLockOwner(lockPath);
			if (persistedOwner?.runId === owner.runId) {
				unlinkSync(ownerPath);
				rmdirSync(lockPath);
			}
		} catch {
			/* a replacement owner or interrupted release must remain intact */
		}
	}
}

interface PreparedStateLedgerWrite {
	committed_state: StateLedger;
	committed_bytes: string;
	ledger_revision: string;
	committed_at: string;
}

function prepareStateLedgerWrite(
	statePath: string,
	state: StateLedger,
): PreparedStateLedgerWrite {
	compactLedgerHistory(statePath, state);
	cleanupStaleLedgerTemps(statePath);
	const committedBytes = JSON.stringify(state, null, 2) + "\n";
	const committedState = JSON.parse(committedBytes) as StateLedger;
	return {
		committed_state: committedState,
		committed_bytes: committedBytes,
		ledger_revision: buildLedgerRevision(committedState),
		committed_at: utcNow(),
	};
}

function writePreparedStateLedgerAtomic(
	statePath: string,
	prepared: PreparedStateLedgerWrite,
): PreparedStateLedgerWrite {
	const tempPath = join(
		dirname(statePath),
		`.${basename(statePath)}.tmp-${process.pid}-${randomUUID()}`,
	);
	const descriptor = openSync(tempPath, "wx", 0o600);
	try {
		writeFileSync(descriptor, prepared.committed_bytes, "utf-8");
		fsyncSync(descriptor);
	} catch (error) {
		try {
			unlinkSync(tempPath);
		} catch {
			/* preserve the last valid ledger */
		}
		throw error;
	} finally {
		closeSync(descriptor);
	}
	renameSync(tempPath, statePath);
	const directory = openSync(dirname(statePath), "r");
	try {
		fsyncSync(directory);
	} finally {
		closeSync(directory);
	}
	return prepared;
}

function writeStateLedgerAtomic(
	statePath: string,
	state: StateLedger,
): Omit<
	CommittedLedgerReceipt,
	| "attempt_id"
	| "source_kind"
	| "source_ref"
	| "receipt_status"
	| "previous_state"
	| "proposed_state"
> {
	return writePreparedStateLedgerAtomic(
		statePath,
		prepareStateLedgerWrite(statePath, state),
	);
}

/**
 * The hot Ledger is parsed by every CLI invocation, so the cross-plan audit
 * trail cannot live in it. Older entries move to a JSONL archive instead.
 */
export const HISTORY_TAIL_LIMIT = 50;

export function ledgerHistoryArchivePath(statePath: string): string {
	return join(dirname(statePath), "current_iteration_history.jsonl");
}

/**
 * Archive before trimming: a failed append must leave the oversized Ledger
 * intact rather than silently destroy the audit trail it was meant to preserve.
 */
function compactLedgerHistory(statePath: string, state: StateLedger): void {
	const history = Array.isArray((state as any).history)
		? (state as any).history
		: [];
	if (history.length <= HISTORY_TAIL_LIMIT) return;
	const overflow = history.slice(0, history.length - HISTORY_TAIL_LIMIT);
	const record = {
		archived_at: utcNow(),
		plan_path: (state as any).plan_path ?? null,
		plan_signature: (state as any).plan_signature ?? null,
		history: overflow,
	};
	appendFileSync(
		ledgerHistoryArchivePath(statePath),
		`${JSON.stringify(record)}\n`,
		"utf-8",
	);
	(state as any).history = history.slice(history.length - HISTORY_TAIL_LIMIT);
}

/** Raw persistence helper for test fixtures only; production authority writes use receipts. */
export function saveStateLedgerForTest(
	statePath: string,
	state: StateLedger,
): void {
  withLedgerWriteLock(statePath, () =>
    writeStateLedgerAtomic(statePath, state),
  );
}

/** @deprecated Test fixture compatibility only. Production code must use receipt-backed commit APIs. */
export const saveStateLedger = saveStateLedgerForTest;

export interface StateCommitExpectation {
	version: string;
	authority_version: string;
	authority_snapshot: Record<string, unknown>;
}

function stateVersion(state: StateLedger): string {
	return createHash("sha256").update(JSON.stringify(state)).digest("hex");
}

export function captureStateCommitExpectation(
	state: StateLedger,
): StateCommitExpectation {
	const authoritySnapshot = projectionAuthorityView(state);
	return {
		version: stateVersion(state),
		authority_version: stateVersion(authoritySnapshot as StateLedger),
		authority_snapshot: authoritySnapshot,
	};
}

function projectionAuthorityView(state: StateLedger): Record<string, unknown> {
	const copy = structuredClone(state) as Record<string, unknown>;
	delete copy.completed_steps;
	delete copy.active_step;
	delete copy.next_action;
	return copy;
}

/** Persist a snapshot-derived state only when the Ledger has not changed since it was read. */
export function stateCommitChangesAuthority(
	state: StateLedger,
	expected: StateCommitExpectation,
): boolean {
	return (
		stateVersion(projectionAuthorityView(state) as StateLedger) !==
		expected.authority_version
	);
}

export function commitStateIfUnchanged(
	statePath: string,
	state: StateLedger,
	expected: StateCommitExpectation,
): boolean {
	let committed = false;
	withLedgerWriteLock(statePath, () => {
		const persisted = normalizeCurrentIteration(
			loadStateLedger(statePath) || createEmptyStateLedger(),
		) as StateLedger;
		if (stateVersion(persisted) !== expected.version) return;
		const proposedAuthority = projectionAuthorityView(state);
		if (
			stateVersion(proposedAuthority as StateLedger) !==
			expected.authority_version
		) {
			const changedFields = Array.from(
				new Set([
					...Object.keys(expected.authority_snapshot),
					...Object.keys(proposedAuthority),
				]),
			)
				.filter(
					(key) =>
						stableStringify(expected.authority_snapshot[key]) !==
						stableStringify(proposedAuthority[key]),
				)
				.sort();
			throw new Error(
				`Snapshot persistence attempted to change authority-owned Ledger fields: ${changedFields.join(", ")}.`,
			);
		}
		writeStateLedgerAtomic(statePath, state);
		committed = true;
	});
	return committed;
}

let beforeStateCommitForTest: ((statePath: string) => void) | null = null;

/** Test-only deterministic interleave seam; production callers never set it. */
export function setBeforeFollowUpCommitForTest(
	hook: ((statePath: string) => void) | null,
): void {
	beforeStateCommitForTest = hook;
}

function terminalizeAuthorityCommitBestEffort(
	statePath: string,
	prepared: PreparedAuthorityCommit,
	status: "committed" | "aborted",
	ledgerRevision: string | null,
): AuthorityCommitReceipt | null {
	try {
		return terminalizeAuthorityCommit(
			statePath,
			prepared,
			status,
			ledgerRevision,
		);
	} catch (error) {
		console.error(
			`warning: v3 authority outcome was decided but its terminal receipt failed: ${
				error instanceof Error ? error.message : error
			}`,
		);
		return null;
	}
}

function prepareStateAuthorityCommitV2(
	statePath: string,
	sourceRef: string,
	previousState: StateLedger,
	proposedState: StateLedger,
	preparedWrite: ReturnType<typeof prepareStateLedgerWrite>,
	beforeBytes: string | null,
): PreparedAuthorityCommit {
	const attemptId = randomUUID();
	const committedAt = utcNow();
	const seed = buildAuthorityObservationSeedV2(
		authorityStatePathIdentity(statePath),
		{
			attempt_id: attemptId,
			source_kind: "state_mutation",
			source_ref: sourceRef,
			receipt_status: "committed",
			previous_state: previousState,
			proposed_state: proposedState,
			committed_state: preparedWrite.committed_state,
			committed_bytes: preparedWrite.committed_bytes,
			ledger_revision: preparedWrite.ledger_revision,
			committed_at: committedAt,
		},
	);
	return prepareAuthorityCommit(statePath, {
		attempt_id: attemptId,
		source_kind: "state_mutation",
		source_ref: sourceRef,
		ledger_revision: preparedWrite.ledger_revision,
		observation_generation: AUTHORITY_OBSERVATION_GENERATION_V2,
		observation_seed: seed,
		targets: [
			{
				absolute_path: statePath,
				before_bytes: beforeBytes,
				after_bytes: preparedWrite.committed_bytes,
			},
		],
	});
}

/** Commit an authority mutation only when the lock-time Ledger matches its read. */
export function commitAuthorityStateIfUnchanged(
	statePath: string,
	state: StateLedger,
	expected: StateCommitExpectation,
	sourceRef: string,
): boolean {
	let didCommit = false;
	try {
		withLedgerWriteLock(statePath, () => {
			recoverAuthorityCommitReceipts(statePath);
			const persisted = normalizeCurrentIteration(
				loadStateLedger(statePath) || createEmptyStateLedger(),
			) as StateLedger;
			if (stateVersion(persisted) !== expected.version) return;
			if (!stateCommitChangesAuthority(state, expected))
				throw new Error(
					"Authority CAS commit requires an authority-owned change.",
				);

			const previousState = structuredClone(persisted) as StateLedger;
			const proposedState = structuredClone(state) as StateLedger;
			const preparedWrite = prepareStateLedgerWrite(statePath, state);
			const beforeBytes = existsSync(statePath)
				? readFileSync(statePath, "utf8")
				: null;
			const authorityAttempt = prepareStateAuthorityCommitV2(
				statePath,
				sourceRef,
				previousState,
				proposedState,
				preparedWrite,
				beforeBytes,
			);
			try {
				writePreparedStateLedgerAtomic(statePath, preparedWrite);
				didCommit = true;
			} catch (error) {
				terminalizeAuthorityCommitBestEffort(
					statePath,
					authorityAttempt,
					"aborted",
					null,
				);
				throw error;
			}
			terminalizeAuthorityCommitBestEffort(
				statePath,
				authorityAttempt,
				"committed",
				preparedWrite.ledger_revision,
			);
		});
	} finally {
		replayMissingAutomaticObservationsV2BestEffort(statePath);
	}
	return didCommit;
}

export function commitStateMutation(
	statePath: string,
	state: StateLedger,
	expected: Pick<StateCommitExpectation, "version">,
	beforeWrite?: (persisted: StateLedger) => void,
	expectedLedgerRevision?: string,
): void {
	const hook = beforeStateCommitForTest;
	beforeStateCommitForTest = null;
	hook?.(statePath);
	try {
		withLedgerWriteLock(statePath, () => {
			recoverAuthorityCommitReceipts(statePath);
			const persisted = normalizeCurrentIteration(
				loadStateLedger(statePath) || createEmptyStateLedger(),
			) as StateLedger;
			if (stateVersion(persisted) !== expected.version)
				throw new Error("State Ledger changed before commit.");
			if (
				expectedLedgerRevision &&
				buildLedgerRevision(persisted) !== expectedLedgerRevision
			) {
				throw new Error("Approved ledger revision changed before commit.");
			}
			beforeWrite?.(persisted);
			const previousState = structuredClone(persisted) as StateLedger;
			const proposedState = structuredClone(state) as StateLedger;
			const preparedWrite = prepareStateLedgerWrite(statePath, state);
			const beforeBytes = existsSync(statePath)
				? readFileSync(statePath, "utf8")
				: null;
			const authorityAttempt = prepareStateAuthorityCommitV2(
				statePath,
				"commitStateMutation",
				previousState,
				proposedState,
				preparedWrite,
				beforeBytes,
			);
			try {
				writePreparedStateLedgerAtomic(statePath, preparedWrite);
			} catch (error) {
				terminalizeAuthorityCommitBestEffort(
					statePath,
					authorityAttempt,
					"aborted",
					null,
				);
				throw error;
			}
			terminalizeAuthorityCommitBestEffort(
				statePath,
				authorityAttempt,
				"committed",
				preparedWrite.ledger_revision,
			);
		});
	} finally {
		replayMissingAutomaticObservationsV2BestEffort(statePath);
	}
}

/** Persist a follow-up mutation only if both the Ledger and target still match. */
export function commitFollowUpMutation(
	statePath: string,
	state: StateLedger,
	expected: FollowUpCommitExpectation,
): void {
	const loaded = normalizeCurrentIteration(
		loadStateLedger(statePath) || createEmptyStateLedger(),
	) as StateLedger;
	const stateExpectation = { version: expected.ledgerVersion };
	const current = requireFollowUpTarget(loaded, expected.id);
	if (
		current.state !== expected.state ||
		followUpVersion(current) !== expected.version
	) {
		throw new Error("Follow-up target changed before commit.");
	}
	commitStateMutation(statePath, state, stateExpectation);
}

function validateCurrentEvidenceContainer(
	container: unknown,
	location: string,
): void {
	if (
		typeof container !== "object" ||
		container === null ||
		Array.isArray(container)
	)
		return;
	const evidence = (container as Record<string, unknown>).execution_evidence;
	if (evidence === null || evidence === undefined) return;
	if (
		typeof evidence !== "object" ||
		Array.isArray(evidence) ||
		(evidence as Record<string, unknown>).evidence_schema !== "structured-v1"
	) {
		throw new Error(
			`${location} contains non-current execution evidence; run imm-migrate.`,
		);
	}
	const record = evidence as Record<string, unknown>;
	if (
		!Array.isArray(record.changed_files) ||
		!Array.isArray(record.checks) ||
		typeof record.notes !== "string" ||
		record.checks.some(
			(check) =>
				typeof check !== "object" ||
				check === null ||
				Array.isArray(check) ||
				!Object.hasOwn(check, "kind"),
		)
	) {
		throw new Error(
			`${location} execution evidence is not normalized; run imm-migrate.`,
		);
	}
	validateReadyForReviewEvidence(record);
	const attempts = (container as Record<string, unknown>).execution_attempts;
	if (attempts === undefined) return;
	if (!Array.isArray(attempts) || attempts.length === 0) {
		throw new Error(
			`${location} execution_attempts must be a non-empty list when present.`,
		);
	}
	for (const attempt of attempts) validateReadyForReviewEvidence(attempt);
	if (
		stableStringify(attempts[attempts.length - 1]) !== stableStringify(record)
	) {
		throw new Error(
			`${location} execution_evidence must equal the latest execution_attempt.`,
		);
	}
}

function validateCurrentLedgerEvidence(state: Record<string, any>): void {
	if (
		typeof state.steps !== "object" ||
		state.steps === null ||
		Array.isArray(state.steps)
	) {
		throw new Error("State Ledger steps must be an object.");
	}
	for (const [stepId, step] of Object.entries(state.steps)) {
		validateCurrentEvidenceContainer(step, `steps.${stepId}`);
	}
	validateCurrentEvidenceContainer(
		state.pending_follow_up,
		"pending_follow_up",
	);
	if (Array.isArray(state.follow_up_history)) {
		state.follow_up_history.forEach((followUp: unknown, index: number) =>
			validateCurrentEvidenceContainer(followUp, `follow_up_history.${index}`),
		);
	}
	state.closed_plan_history.forEach(
		(archive: unknown, archiveIndex: number) => {
			if (
				typeof archive !== "object" ||
				archive === null ||
				Array.isArray(archive)
			)
				return;
			const record = archive as Record<string, unknown>;
			if (Array.isArray(record.steps)) {
				record.steps.forEach((step, stepIndex) =>
					validateCurrentEvidenceContainer(
						step,
						`closed_plan_history.${archiveIndex}.steps.${stepIndex}`,
					),
				);
			}
			if (Array.isArray(record.follow_ups)) {
				record.follow_ups.forEach((followUp, followUpIndex) =>
					validateCurrentEvidenceContainer(
						followUp,
						`closed_plan_history.${archiveIndex}.follow_ups.${followUpIndex}`,
					),
				);
			}
		},
	);
}

export function normalizeCurrentIteration(
	state: Record<string, any>,
): Record<string, any> {
	validateTransitionState(state);
	validateCurrentLedgerEvidence(state);
	if (state.plan_terminal != null && !getPlanTerminal(state)) {
		throw new Error("Invalid Plan terminal marker in State Ledger.");
	}
	const normalized: Record<string, any> = {
		schema_version: 3,
		steps: state.steps,
		pending_follow_up: state.pending_follow_up ?? null,
		last_review: state.last_review ?? null,
		validated_plan_snapshot: state.validated_plan_snapshot ?? null,
		history: Array.isArray(state.history) ? state.history : [],
		review_follow_up_start_index:
			state.review_follow_up_start_index === undefined
				? 0
				: state.review_follow_up_start_index,
		requires_replan: state.requires_replan ?? false,
		runtime_status: state.runtime_status ?? "idle",
		closed_plan_history: state.closed_plan_history,
		plan_transition_history: state.plan_transition_history,
		roadmap_phase_completion_history: Array.isArray(
			state.roadmap_phase_completion_history,
		)
			? state.roadmap_phase_completion_history
			: [],
		plan_termination_history: Array.isArray(state.plan_termination_history)
			? state.plan_termination_history
			: [],
		plan_terminal: state.plan_terminal ?? null,
	};
	for (const [k, v] of Object.entries(state)) {
		if (!(k in normalized)) normalized[k] = v;
	}
	return normalized;
}

export interface ReviewPassRecord {
	gate: string;
	decision: "pass";
	reviewed_changed_files: string[];
	changed_files_signature: string;
	evidence_ref: string;
	reviewer_skill: string;
	reviewed_at: string;
}

export interface RecordReviewPassInput {
	gate: string;
	changed_files: string[];
	evidence_ref: string;
	reviewer_skill: string;
	reviewed_at?: string;
}

export function normalizeReviewChangedFiles(changedFiles: string[]): string[] {
	return [
		...new Set(changedFiles.map((p) => p.trim()).filter((p) => p.length > 0)),
	].sort();
}

function collectChangedFilesFromTargets(
  targets: Array<Record<string, any>>,
  label: string,
): string[] {
  const out: string[] = [];
  for (const target of targets) {
    if (target?.state !== "closed") {
      throw new Error(`${label} contains non-closed execution evidence.`);
    }
    const evidence = target.execution_evidence;
    if (evidence === null || evidence === undefined) {
      // Legacy closed follow-ups (e.g. debug closures) may legitimately carry
      // no execution evidence; they contribute no changed files. The State
      // Ledger schema allows `execution_evidence: null`.
      continue;
    }
    const changedFiles = evidence.changed_files;
    if (!Array.isArray(changedFiles)) {
      throw new Error(`${label} contains malformed changed_files evidence.`);
    }
    out.push(...changedFiles);
  }
  return out;
}

function closedPlanArchiveId(
  archive: Omit<ClosedPlanArchive, "archive_id">,
): string {
  return createHash("sha256")
    .update(
      ARCHIVE_ID_DOMAIN +
        stableStringify({
          plan_path: archive.plan_path,
          plan_signature: archive.plan_signature,
          validated_plan_snapshot: archive.validated_plan_snapshot,
          steps: archive.steps,
          follow_ups: archive.follow_ups,
          review_state: archive.review_state,
          last_review: archive.last_review,
          finish_timestamp: archive.finish_timestamp,
        }),
    )
    .digest("hex");
}

function archiveChangedFiles(archive: ClosedPlanArchive): string[] {
  if (!Array.isArray(archive.steps) || !Array.isArray(archive.follow_ups)) {
    throw new Error(
      "Same-Phase predecessor archive has malformed evidence arrays.",
    );
  }
  const { archive_id: _archiveId, ...payload } = archive;
  if (closedPlanArchiveId(payload) !== archive.archive_id) {
    throw new Error("Same-Phase predecessor archive content hash is invalid.");
  }
  return collectChangedFilesFromTargets(
    [...archive.steps, ...archive.follow_ups],
    "Same-Phase predecessor archive",
  );
}

function collectSamePhaseArchiveChangedFiles(
  state: Record<string, any>,
): string[] {
  validateTransitionState(state);
  const transitions = state.plan_transition_history as TransitionRecord[];
  const archives = state.closed_plan_history as ClosedPlanArchive[];
  const incomingByPath = new Map<string, TransitionRecord>();
  const incomingBySignature = new Map<string, TransitionRecord>();
  for (const transition of transitions) {
    const path = transition.validation.successor_plan_path;
    const signature = transition.validation.successor_plan_signature;
    if (incomingByPath.has(path) || incomingBySignature.has(signature)) {
      throw new Error("Same-Phase continuation history has ambiguous incoming transitions.");
    }
    incomingByPath.set(path, transition);
    incomingBySignature.set(signature, transition);
  }
  const archivesById = new Map<string, ClosedPlanArchive>();
  for (const archive of archives) {
    if (archivesById.has(archive.archive_id)) {
      throw new Error("Same-Phase continuation history has duplicate archive IDs.");
    }
    archivesById.set(archive.archive_id, archive);
  }
  const out: string[] = [];
  let planPath = String(state.plan_path || "")
    .split("\\")
    .join("/");
  let planSignature = String(state.plan_signature || "");
  const visitedTransitions = new Set<string>();
  while (planPath && planSignature) {
    const byPath = incomingByPath.get(planPath);
    const bySignature = incomingBySignature.get(planSignature);
    if (!byPath && !bySignature) break;
    if (!byPath || !bySignature || byPath !== bySignature) {
      throw new Error(
        `Plan '${planPath}' has mismatched incoming transition identity.`,
      );
    }
    const transition = byPath;
    if (transition.transition_kind !== "same_phase_continuation") break;
    if (visitedTransitions.has(transition.transition_id)) {
      throw new Error("Same-Phase continuation history contains a cycle.");
    }
    visitedTransitions.add(transition.transition_id);
    const archive = archivesById.get(transition.predecessor_archive_ref);
    if (!archive) {
      throw new Error(
        "Same-Phase continuation predecessor archive reference is missing or ambiguous.",
      );
    }
    if (
      archive.plan_path !== transition.declaration.predecessor_plan_path ||
      archive.plan_signature !==
        transition.declaration.predecessor_plan_signature
    ) {
      throw new Error(
        "Same-Phase continuation predecessor archive identity is inconsistent.",
      );
    }
    out.push(...archiveChangedFiles(archive));
    planPath = transition.declaration.predecessor_plan_path;
    planSignature = transition.declaration.predecessor_plan_signature;
  }
  return out;
}

export function collectReviewChangedFiles(
	state: Record<string, any>,
): string[] {
	const out: string[] = [];
	const followUpHistory = Array.isArray(state.follow_up_history)
		? state.follow_up_history
		: [];
	const startIndex =
		state.review_follow_up_start_index === undefined
			? 0
			: state.review_follow_up_start_index;
	if (
		!Number.isInteger(startIndex) ||
		startIndex < 0 ||
		startIndex > followUpHistory.length
	) {
		throw new Error(
			`State Ledger review_follow_up_start_index must be an integer between 0 and follow_up_history length (${followUpHistory.length}).`,
		);
	}
	const targets = [
		...Object.values(state.steps || {}).filter(
			(step: any) => step.state === "closed",
		),
		...followUpHistory
			.slice(startIndex)
			.filter((followUp: any) => followUp?.state === "closed"),
	] as Array<Record<string, any>>;
  out.push(...collectChangedFilesFromTargets(targets, "Current review scope"));
  out.push(...collectSamePhaseArchiveChangedFiles(state));
	return normalizeReviewChangedFiles(out);
}

export function buildReviewChangedFilesSignature(
	changedFiles: string[],
): string {
	return createHash("sha256")
		.update(JSON.stringify(normalizeReviewChangedFiles(changedFiles)))
		.digest("hex");
}

function ensureReviewState(state: Record<string, any>): {
	gates: Record<string, ReviewPassRecord>;
} {
	const existing = state.review_state;
	if (
		typeof existing === "object" &&
		existing !== null &&
		!Array.isArray(existing)
	) {
		if (
			typeof existing.gates === "object" &&
			existing.gates !== null &&
			!Array.isArray(existing.gates)
		) {
			return existing as { gates: Record<string, ReviewPassRecord> };
		}
		existing.gates = {};
		return existing as { gates: Record<string, ReviewPassRecord> };
	}
	const reviewState = { gates: {} as Record<string, ReviewPassRecord> };
	state.review_state = reviewState;
	return reviewState;
}

export function recordReviewPass(
	state: Record<string, any>,
	input: RecordReviewPassInput,
): ReviewPassRecord {
	const gate = input.gate.trim();
	const reviewerSkill = input.reviewer_skill.trim();
	const evidenceRef = input.evidence_ref.trim();
	const reviewedChangedFiles = normalizeReviewChangedFiles(input.changed_files);
	if (!gate) throw new Error("review_state requires a non-empty gate.");
	if (!reviewerSkill)
		throw new Error("review_state requires a non-empty reviewer_skill.");
	if (!evidenceRef)
		throw new Error("review_state requires a non-empty evidence_ref.");
	if (reviewedChangedFiles.length === 0)
		throw new Error("review_state requires changed files.");
	const entry: ReviewPassRecord = {
		gate,
		decision: "pass",
		reviewed_changed_files: reviewedChangedFiles,
		changed_files_signature:
			buildReviewChangedFilesSignature(reviewedChangedFiles),
		evidence_ref: evidenceRef,
		reviewer_skill: reviewerSkill,
		reviewed_at: input.reviewed_at || utcNow(),
	};
	ensureReviewState(state).gates[gate] = entry;
	return entry;
}

export function getReviewPassForChangedFiles(
	state: Record<string, any>,
	gate: string,
	changedFiles: string[],
): ReviewPassRecord | null {
	const reviewState = state.review_state;
	if (
		typeof reviewState !== "object" ||
		reviewState === null ||
		Array.isArray(reviewState)
	)
		return null;
	const gates = reviewState.gates;
	if (typeof gates !== "object" || gates === null || Array.isArray(gates))
		return null;
	const entry = gates[gate];
	if (!entry || entry.decision !== "pass") return null;
	const signature = buildReviewChangedFilesSignature(changedFiles);
	return entry.changed_files_signature === signature ? entry : null;
}

const UI_REVIEW_PATH_RE =
	/(^|\/)(view|views|component|components|layout|layouts|style|styles|theme|themes|locale|locales|i18n)(\/|\.|$)/i;
const STYLE_MARKUP_SUFFIX_RE = /\.(css|scss|html)$/;
const UI_SUFFIX_RE = /\.(css|scss|html|tsx|jsx)$/;
const CODE_SUFFIX_RE = /\.(ts|js|tsx|jsx|json|yaml|yml|md)$/;

function isDesignDoc(lower: string): boolean {
	return lower === "design.md" || lower.endsWith("/design.md");
}

/** A path the UI reviewer must inspect: design docs, style/markup, JSX, or a UI-shaped directory. */
function needsUiReviewForPath(lower: string): boolean {
	return (
		isDesignDoc(lower) ||
		UI_SUFFIX_RE.test(lower) ||
		UI_REVIEW_PATH_RE.test(lower)
	);
}

/** A path carrying reviewable program logic. Style/markup and design docs are not code. */
function isCodeFile(lower: string): boolean {
	if (isDesignDoc(lower)) return false;
	if (STYLE_MARKUP_SUFFIX_RE.test(lower)) return false;
	return CODE_SUFFIX_RE.test(lower);
}

/**
 * A path fully covered by UI review alone, so code review can be skipped for it.
 * Note the deliberate asymmetry with {@link needsUiReviewForPath}: a code-capable
 * file (`.ts`/`.tsx`/`.jsx`) only counts as UI-covered when it also lives under a
 * UI-shaped directory (`components/`, `views/`, `theme/`, ...). A `.tsx` outside
 * such a directory (for example root `App.tsx`) still requires code review.
 */
function coveredByUiReviewAlone(lower: string): boolean {
	return (
		isDesignDoc(lower) ||
		STYLE_MARKUP_SUFFIX_RE.test(lower) ||
		UI_REVIEW_PATH_RE.test(lower)
	);
}

export function determineRequiredReviewGates(changedFiles: string[]): string[] {
	const normalized = normalizeReviewChangedFiles(changedFiles);
	if (normalized.length === 0) return [];
	const lowers = normalized.map((path) => path.toLowerCase());

	const needsUiReview = lowers.some(needsUiReviewForPath);
	const needsCodeReview = lowers.some(isCodeFile);
	const everyFileCoveredByUi = lowers.every(coveredByUiReviewAlone);

	const gates: string[] = [];
	if (needsCodeReview && !everyFileCoveredByUi) gates.push("imm-code-review");
	if (needsUiReview) gates.push("imm-ui-review");
	return gates;
}

// ── validated plan snapshot ──────────────────────────────────────────

export function buildValidatedPlanSnapshot(
	canonicalPlanPath: string,
	planSignature: string,
	normalizedPlan: NormalizedPlan,
): Record<string, unknown> {
	return {
		plan_path: canonicalPlanPath,
		plan_signature: planSignature,
		summary: normalizedPlan.summary,
		task: structuredClone(normalizedPlan.task),
		steps: normalizedPlan.steps.map((s) => ({
			number: s.number,
			step_id: s.step_id,
			result: s.result,
			verification: s.verification,
			scope: s.scope,
			depends_on: s.depends_on,
			discovery_cache: s.discovery_cache,
			parallel_probes: s.parallel_probes,
			agent_hint: s.agent_hint ?? null,
			test_scenarios: s.test_scenarios ?? null,
		})),
	};
}

export function completedPrefixNumbers(completedSteps: number[]): number[] {
	if (completedSteps.length === 0) return [];
	const sorted = [...completedSteps].sort((a, b) => a - b);
	const prefix: number[] = [];
	let expected = 1;
	for (const step of sorted) {
		if (step === expected) {
			prefix.push(step);
			expected++;
		} else break;
	}
	return prefix;
}

// ── Phase 2 transition state primitives ─────────────────────────────

const REVISION_DOMAIN = "immune-brain-ledger-revision/v1\u0000";
const EXPLICIT_TRANSITION_ID_DOMAIN = "immune-brain-transition-id/v2\u0000";
const ARCHIVE_ID_DOMAIN = "immune-brain-archive-id/v1\u0000";

/**
 * Domain-separated stable SHA-256 over the complete normalized Ledger.
 * JSON key order and whitespace do not affect the revision; array order does.
 * The revision itself is never persisted or included in the hash input.
 */
export function buildLedgerRevision(state: Record<string, any>): string {
	const input = { ...state };
	// Exclude any previously-derived revision from the input so it is self-consistent
	delete input.ledger_revision;
	const payload = REVISION_DOMAIN + stableStringify(input);
	return createHash("sha256").update(payload).digest("hex");
}

/**
 * Strict Plan identity for persisted transition expectations.
 * Unlike Plan normalization, this rejects paths outside the project or through
 * symlinks so an approval cannot bind to a different filesystem object.
 */
export function canonicalizeTrustedPlanIdentity(
	planPath: string,
	projectRoot: string,
): string {
	const resolved = resolve(projectRoot, planPath);
	let rootReal: string;
	let resolvedReal: string;
	try {
		rootReal = realpathSync(projectRoot);
		resolvedReal = realpathSync(resolved);
	} catch {
		throw new Error(`Plan file '${planPath}' does not exist.`);
	}
	const relativePath = relative(rootReal, resolvedReal);
	if (
		!relativePath ||
		relativePath === ".." ||
		relativePath.startsWith(`..${sep}`)
	) {
		throw new Error(
			`Plan path '${planPath}' resolves outside the project root.`,
		);
	}
	// Must be a real regular file (not a symlink)
	let stats;
	try {
		stats = statSync(resolved, { throwIfNoEntry: true });
	} catch {
		throw new Error(`Plan file '${planPath}' does not exist.`);
	}
	if (!stats.isFile()) {
		throw new Error(`Plan path '${planPath}' is not a regular file.`);
	}
	// Use lstat to reject a symlink at the Plan path itself.
	let lstats;
	try {
		lstats = lstatSync(resolved, { throwIfNoEntry: true });
	} catch {
		throw new Error(`Plan file '${planPath}' does not exist.`);
	}
	if (lstats.isSymbolicLink()) {
		throw new Error(
			`Plan path '${planPath}' is a symlink; symlinks are not accepted as canonical identity.`,
		);
	}
	return relativePath.replace(/\\/g, "/");
}

export interface ClosedPlanArchive {
	archive_id: string;
	plan_path: string;
	plan_signature: string;
	validated_plan_snapshot: Record<string, unknown>;
	steps: Array<Record<string, unknown>>;
	follow_ups: Array<Record<string, unknown>>;
	review_state: Record<string, unknown>;
	last_review: unknown;
	finish_timestamp: string;
}

export interface BuildArchiveInput {
	canonical_plan_path: string;
	plan_signature: string;
	validated_plan_snapshot: unknown;
	finish_timestamp: string;
}

/**
 * Build a whitelisted, Plan-scoped predecessor archive from the current Ledger state.
 * Only normalized predecessor evidence is included; arbitrary extensions,
 * prior collections, and global history are excluded.
 */
export function buildClosedPlanArchive(
	state: Record<string, any>,
	input: BuildArchiveInput,
): ClosedPlanArchive {
	const startIdx =
		typeof state.review_follow_up_start_index === "number"
			? state.review_follow_up_start_index
			: 0;
	const followUps = Array.isArray(state.follow_up_history)
		? state.follow_up_history
				.slice(startIdx)
				.map((fu: any) => structuredClone(fu))
		: [];
	const steps = Object.values(state.steps || {})
		.map((s: any) => structuredClone(s))
		.filter((s: any) => s && s.state === "closed");
	const reviewState =
		state.review_state && typeof state.review_state === "object"
			? structuredClone(state.review_state)
			: { gates: {} };
	const snapshot =
		input.validated_plan_snapshot &&
		typeof input.validated_plan_snapshot === "object"
			? structuredClone(
					input.validated_plan_snapshot as Record<string, unknown>,
				)
			: {};
	const archive: ClosedPlanArchive = {
		archive_id: "",
		plan_path: input.canonical_plan_path,
		plan_signature: input.plan_signature,
		validated_plan_snapshot: snapshot,
		steps,
		follow_ups: followUps,
		review_state: reviewState,
		last_review: structuredClone(state.last_review ?? null),
		finish_timestamp: input.finish_timestamp,
	};
  archive.archive_id = closedPlanArchiveId(archive);
	return archive;
}

export interface TransitionDeclaration {
	predecessor_plan_path: string;
	predecessor_plan_signature: string;
	predecessor_phase: string;
	declared_candidate: string;
	roadmap_source: string;
}

export interface TransitionValidation {
	validated_at: string;
	successor_plan_path: string;
	successor_plan_signature: string;
	successor_phase: string;
  successor_candidate?: string;
  predecessor_terminated?: boolean;
}

export interface TransitionApproval {
	actor: string;
	approved_revision: string;
	recorded_at: string;
}

export interface TransitionActivation {
	committed_at: string;
}

export type TransitionKind =
  "same_phase_continuation" | "phase_advance" | "terminated_replacement";

export interface TransitionRecord {
	transition_id: string;
	predecessor_archive_ref: string;
  transition_kind?: TransitionKind;
	declaration: TransitionDeclaration;
	validation: TransitionValidation;
	approval: TransitionApproval;
	activation: TransitionActivation;
}

export interface BuildTransitionInput {
	predecessor_archive_id: string;
	predecessor_plan_path: string;
	predecessor_plan_signature: string;
	successor_plan_path: string;
	successor_plan_signature: string;
	predecessor_phase: string;
	successor_phase: string;
  successor_candidate: string;
	roadmap_source: string;
	declared_candidate: string;
  terminated_predecessor: boolean;
	approved_revision: string;
}

export function deriveTransitionKind(
  input: Pick<
    BuildTransitionInput,
    | "predecessor_phase"
    | "successor_phase"
    | "declared_candidate"
    | "successor_candidate"
    | "terminated_predecessor"
  >,
): TransitionKind {
  if (input.terminated_predecessor) {
    if (
      input.successor_phase === input.predecessor_phase ||
      (input.declared_candidate !== "none" &&
        input.successor_phase === input.declared_candidate)
    ) {
      return "terminated_replacement";
    }
  } else if (
    input.successor_phase === input.predecessor_phase &&
    input.successor_candidate === input.declared_candidate
  ) {
    return "same_phase_continuation";
  } else if (
    input.declared_candidate !== "none" &&
    input.successor_phase === input.declared_candidate
  ) {
    return "phase_advance";
  }
  throw new Error(
    "Predecessor and successor Phase metadata do not authorize a transition.",
  );
}

/** Build the integrity identity for an explicit transition record. */
function transitionRecordId(input: {
  predecessor_archive_ref: string;
  transition_kind: TransitionKind;
  declaration: TransitionDeclaration;
  validation: Omit<TransitionValidation, "validated_at">;
  approved_revision: string;
}): string {
  return createHash("sha256")
    .update(EXPLICIT_TRANSITION_ID_DOMAIN + stableStringify(input))
    .digest("hex");
}

/**
 * Build an immutable transition record with a deterministic transition ID.
 * Declaration, validation, approval, and activation timestamps are separate
 * evidence. The ID covers every immutable authority fact.
 */
export function buildTransitionRecord(
	input: BuildTransitionInput,
): TransitionRecord {
	const now = utcNow();
	const normalizedInput = {
		...input,
		successor_candidate: input.successor_candidate ?? "none",
		terminated_predecessor: input.terminated_predecessor ?? false,
	};
	const transitionKind = deriveTransitionKind(normalizedInput);
	const declaration: TransitionDeclaration = {
		predecessor_plan_path: input.predecessor_plan_path,
		predecessor_plan_signature: input.predecessor_plan_signature,
		predecessor_phase: input.predecessor_phase,
		declared_candidate: input.declared_candidate,
		roadmap_source: input.roadmap_source,
	};
	const validation: TransitionValidation = {
		validated_at: now,
		successor_plan_path: input.successor_plan_path,
		successor_plan_signature: input.successor_plan_signature,
		successor_phase: input.successor_phase,
		successor_candidate: normalizedInput.successor_candidate,
		predecessor_terminated: normalizedInput.terminated_predecessor,
	};
  const transitionId = transitionRecordId({
    predecessor_archive_ref: input.predecessor_archive_id,
    transition_kind: transitionKind,
    declaration,
    validation: {
      successor_plan_path: validation.successor_plan_path,
      successor_plan_signature: validation.successor_plan_signature,
      successor_phase: validation.successor_phase,
      successor_candidate: validation.successor_candidate,
      predecessor_terminated: validation.predecessor_terminated,
    },
    approved_revision: input.approved_revision,
  });
	return {
		transition_id: transitionId,
		predecessor_archive_ref: input.predecessor_archive_id,
    transition_kind: transitionKind,
		declaration,
		validation,
		approval: {
			actor: "user",
			approved_revision: input.approved_revision,
			recorded_at: now,
		},
		activation: {
			committed_at: now,
		},
	};
}

/** Validate the current transition-state contract. */
export function validateTransitionState(state: Record<string, any>): void {
	if (state.schema_version !== 3) {
		throw new Error(
			`Unsupported schema_version ${String(state.schema_version)}; run imm-migrate with the current runtime.`,
		);
	}
	if (!Array.isArray(state.closed_plan_history)) {
		throw new Error("schema v3 requires closed_plan_history as an array.");
	}
	if (!Array.isArray(state.plan_transition_history)) {
		throw new Error("schema v3 requires plan_transition_history as an array.");
	}
	validateRoadmapPhaseCompletionHistory(
		state.roadmap_phase_completion_history,
	);
	const ids = new Set<string>();
  const successorPaths = new Set<string>();
  const successorSignatures = new Set<string>();
	for (const record of state.plan_transition_history) {
		const id = record?.transition_id;
		if (typeof id !== "string" || id.length === 0) {
			throw new Error(
				"plan_transition_history contains a record with a missing transition_id.",
			);
		}
		if (ids.has(id)) {
			throw new Error(
				`Duplicate transition_id '${id}' in plan_transition_history.`,
			);
		}
		ids.add(id);
    const successorPath = record?.validation?.successor_plan_path;
    const successorSignature = record?.validation?.successor_plan_signature;
    if (
      typeof successorPath !== "string" ||
      !successorPath ||
      typeof successorSignature !== "string" ||
      !successorSignature
    ) {
      throw new Error(`Transition '${id}' has a malformed successor identity.`);
    }
    if (
      successorPaths.has(successorPath) ||
      successorSignatures.has(successorSignature)
    ) {
      throw new Error(
        `Transition '${id}' creates an ambiguous incoming transition.`,
      );
    }
    successorPaths.add(successorPath);
    successorSignatures.add(successorSignature);
    const kind = record.transition_kind;
    if (kind === undefined) continue;
    if (
      kind !== "same_phase_continuation" &&
      kind !== "phase_advance" &&
      kind !== "terminated_replacement"
    ) {
      throw new Error(`Transition '${id}' has an unknown transition_kind.`);
    }
    const predecessorPhase = record?.declaration?.predecessor_phase;
    const successorPhase = record?.validation?.successor_phase;
    const predecessorCandidate = record?.declaration?.declared_candidate;
    const successorCandidate = record?.validation?.successor_candidate;
    const predecessorTerminated = record?.validation?.predecessor_terminated;
    const predecessorArchiveRef = record?.predecessor_archive_ref;
    const predecessorPath = record?.declaration?.predecessor_plan_path;
    const predecessorSignature = record?.declaration?.predecessor_plan_signature;
    const roadmapSource = record?.declaration?.roadmap_source;
    const approvedRevision = record?.approval?.approved_revision;
    const approvalActor = record?.approval?.actor;
    if (
      typeof predecessorPhase !== "string" ||
      typeof successorPhase !== "string" ||
      typeof predecessorCandidate !== "string" ||
      typeof successorCandidate !== "string" ||
      typeof predecessorTerminated !== "boolean" ||
      typeof predecessorArchiveRef !== "string" ||
      !predecessorArchiveRef ||
      typeof predecessorPath !== "string" ||
      !predecessorPath ||
      typeof predecessorSignature !== "string" ||
      !predecessorSignature ||
      typeof roadmapSource !== "string" ||
      !roadmapSource ||
      typeof approvedRevision !== "string" ||
      !approvedRevision ||
      approvalActor !== "user"
    ) {
      throw new Error(
        `Transition '${id}' with transition_kind has incomplete authority facts.`,
      );
    }
    const derivedKind = deriveTransitionKind({
      predecessor_phase: predecessorPhase,
      successor_phase: successorPhase,
      declared_candidate: predecessorCandidate,
      successor_candidate: successorCandidate,
      terminated_predecessor: predecessorTerminated,
    });
    if (kind !== derivedKind) {
      throw new Error(
        `Transition '${id}' transition_kind does not match its canonical authority facts.`,
      );
    }
    const expectedId = transitionRecordId({
      predecessor_archive_ref: predecessorArchiveRef,
      transition_kind: kind,
      declaration: record.declaration,
      validation: {
        successor_plan_path: successorPath,
        successor_plan_signature: successorSignature,
        successor_phase: successorPhase,
        successor_candidate: successorCandidate,
        predecessor_terminated: predecessorTerminated,
      },
      approved_revision: approvedRevision,
    });
    if (id !== expectedId) {
      throw new Error(`Transition '${id}' content hash is invalid.`);
    }
	}
}

// ── heal ────────────────────────────────────────────────────────────
