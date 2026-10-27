// Lane-mode batch driver. With `max_parallel` given, an unattended batch runs
// each child in a Lane: a separate worktree on its own branch, supplied by
// someone else, with its own Authority Store. This module admits offered Lanes,
// enrolls children into them, commits their settled delivery on the lane branch
// and integrates it into the batch branch. It never creates, switches or
// deletes a Git worktree and never names a workspace tool.
// Defined by docs/specs/parallel-batch-lanes.spec.md and ADR 0013.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, realpathSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { computeBatchPlanDigest } from "../kernel/batch_authority";
import { intentAuthorityHash, readTaskIntent } from "../kernel/intent";
import { readTaskTombstone } from "../kernel/backend_claim";
import {
	readRuntimeContracts,
	runningRuntimeSource,
	RUNTIME_CONTRACTS,
	runtimeContractDifferences,
} from "../kernel/runtime_contracts";
import { readFileSync } from "node:fs";
import { readDerivedFilesAt } from "../derived_files";
import { runFinalVerification, type FinalVerificationReport } from "./batch_final_verification";
import { buildBatchFinalReport, returnBatchToCoordinator } from "./batch_final_report";
import { runGithubTrackerOperation } from "../github_issue_tracker";
import { hasLocalInitiative } from "../local_initiative";
import type { BatchTrackerPort, StartBatchInput } from "./batch_runner";
import {
	BatchIntegrationError,
	findIntegratedCandidate,
	integrateGuardedLaneCommit,
	type IntegrationCheckChild,
} from "./batch_integration";
import { isBatchRef, isParentBranch } from "./batch_ref";
import { assertLaneWorktreeAvailable, copyLanePlanningInput, createLaneWorktree } from "./batch_worktrees";
import { classifyBatchLineage, expectedBatchHead, findExistingActiveBatch, porcelainEntries, readActiveClaimTaskId, unsettledChildScopes } from "./batch_preflight";
import { restoreProvableLaneLeaks } from "./batch_leak_restore";
import { withBatchEvidence } from "./batch_git";
import { blockedByParked, startableChildren } from "./batch_schedule";
import {
	type AnyBatchRunStateRecord,
	type BatchLaneChildRun,
	type BatchLaneHandoff,
	type BatchLaneRunReport,
	type BatchLaneRunStateRecord,
	isLaneBatchRecord,
	isTerminalBatchState,
	prepareBatchLaneRunState,
	writeBatchLaneRunState,
	writeBatchRunReport,
} from "./batch_state";
import { createDefaultBatchGitPort, type BatchRunnerGitPort } from "./batch_git";
import { LANE_EXECUTOR_HOSTS } from "../role_prompt_bridge";
import { parentRuntimeSkew, pluginSourceSkewWarning } from "../plugin_source_skew";

export { LANE_EXECUTOR_HOSTS };

export type LaneAdmissionReason =
	| "batch_lane_foreign_repository"
	| "batch_lane_is_coordinator"
	| "batch_lane_branch_mismatch"
	| "batch_lane_base_mismatch"
	| "batch_lane_dirty"
	| "batch_lane_occupied"
	| "batch_lane_unknown_child";

export const PARALLEL_MISMATCH = "batch_parallel_mismatch";

export interface LaneOffer {
	task_id: string;
	path: string;
}

const TASK_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const MAX_LANE_OFFERS = 64;
const MAX_PATH_LENGTH = 4096;

/** New batches default to one Lane; a resume keeps its recorded parallelism. */
export function resolveLaneParallel(
	root: string,
	initiativeSlug: string,
	maxParallel: number | undefined,
	laneOffers: unknown,
	_laneInstruction?: unknown,
): number {
	const existing = findExistingActiveBatch(root, initiativeSlug);
	if (existing && !existing.corrupt && !isLaneBatchRecord(existing.record))
		throw new Error("batch_record_shape_retired: inspect the record, then use retire_stale_batch in the current Host");
	if (laneOffers !== undefined && (!existing || (!existing.corrupt && isParentBranch(existing.record.branch))))
		throw new Error("lane_offers_retired: new batches create their own Lanes");
	return parseMaxParallel(maxParallel) ?? (existing && !existing.corrupt && isLaneBatchRecord(existing.record) ? existing.record.max_parallel : 1);
}

/** A positive safe integer, or undefined when the parameter is absent. */
export function parseMaxParallel(value: unknown): number | undefined {
	if (value === undefined || value === null) return undefined;
	if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0)
		throw new Error("invalid max_parallel: expected a positive integer");
	return value;
}

/** Offers are untrusted input: shape-checked here, path-checked at admission. */
export function parseLaneOffers(value: unknown): LaneOffer[] | undefined {
	if (value === undefined || value === null) return undefined;
	if (!Array.isArray(value)) throw new Error("invalid lane_offers: expected an array");
	if (value.length > MAX_LANE_OFFERS) throw new Error(`invalid lane_offers: at most ${MAX_LANE_OFFERS} offers`);
	const seen = new Set<string>();
	return value.map((entry) => {
		if (typeof entry !== "object" || entry === null || Array.isArray(entry))
			throw new Error("invalid lane_offers: each offer must be an object");
		const { task_id: taskId, path, ...rest } = entry as Record<string, unknown>;
		if (Object.keys(rest).length > 0) throw new Error("invalid lane_offers: unknown offer field");
		if (typeof taskId !== "string" || !TASK_ID_PATTERN.test(taskId))
			throw new Error("invalid lane_offers: task_id is not a valid task id");
		if (
			typeof path !== "string" ||
			!path ||
			path.length > MAX_PATH_LENGTH ||
			path.includes("\0") ||
			!isAbsolute(path)
		)
			throw new Error("invalid lane_offers: path must be an absolute path");
		if (seen.has(taskId)) throw new Error(`invalid lane_offers: duplicate offer for ${taskId}`);
		seen.add(taskId);
		return { task_id: taskId, path };
	});
}

/**
 * The production tracker port both Hosts hand a lane batch: the same
 * `mark-terminal` projection a single task runs after settlement. A Local
 * Initiative has no tracker, so it gets none.
 */
export function createBatchTrackerPort(root: string, initiativeSlug: string): BatchTrackerPort | undefined {
	if (hasLocalInitiative(root, initiativeSlug)) return undefined;
	return { markTerminal: (trackerRoot, input) => runGithubTrackerOperation(trackerRoot, { op: "mark-terminal", ...input }) };
}

export interface LaneInstructionRequest {
	task_id: string;
	kind: "instruction" | "correction";
	text: string;
	/** The Lane session's state as the Parent just observed it from its supervised session. */
	session_state: "idle" | "working" | "blocked" | "done";
}

const MAX_INSTRUCTION_LENGTH = 4000;

/** Untrusted tool input, shape-checked here and decided against the record below. */
export function parseLaneInstruction(value: unknown): LaneInstructionRequest | undefined {
	if (value === undefined || value === null) return undefined;
	if (typeof value !== "object" || Array.isArray(value)) throw new Error("invalid lane_instruction: expected an object");
	const { task_id: taskId, kind = "instruction", text, session_state: sessionState, ...rest } = value as Record<string, unknown>;
	if (Object.keys(rest).length > 0) throw new Error("invalid lane_instruction: unknown field");
	if (typeof taskId !== "string" || !TASK_ID_PATTERN.test(taskId)) throw new Error("invalid lane_instruction: task_id is not a valid task id");
	if (kind !== "instruction" && kind !== "correction") throw new Error("invalid lane_instruction: kind must be instruction or correction");
	if (typeof text !== "string" || !text.trim() || text.length > MAX_INSTRUCTION_LENGTH)
		throw new Error(`invalid lane_instruction: text must be 1 to ${MAX_INSTRUCTION_LENGTH} characters`);
	if (sessionState !== "idle" && sessionState !== "working" && sessionState !== "blocked" && sessionState !== "done")
		throw new Error("invalid lane_instruction: session_state must be idle, working, blocked or done");
	return { task_id: taskId, kind, text, session_state: sessionState };
}

/**
 * Whether the coordinator may send this text to the Lane session now. Text goes
 * only to an idle session of a child that is still running in its Lane. A
 * blocked session shows a dialog only the user may answer (trust, sign-in,
 * permission, a question, a native confirmation), so it never receives input;
 * a working session is not interrupted. Null means allowed.
 */
export function decideLaneInstruction(record: BatchLaneRunStateRecord, request: LaneInstructionRequest): string | null {
	const child = record.children.find((c) => c.task_id === request.task_id);
	if (!child || !child.lane) return `${request.task_id} has no Lane in this batch`;
	if (child.state !== "enrolled") return `${request.task_id} is ${child.state}, not running in its Lane`;
	if (request.kind === "correction" && !child.correction_due)
		return `${request.task_id} has not exhausted its rework budget; send an ordinary instruction instead`;
	if (request.kind === "instruction" && child.correction_due)
		return `${request.task_id} waits for a design-level correction; send it with kind correction`;
	if (request.session_state === "blocked")
		return `${request.task_id}'s session is blocked on a dialog only the user may answer; send nothing and tell the user`;
	if (request.session_state !== "idle") return `${request.task_id}'s session is ${request.session_state}; text goes only to an idle session`;
	return null;
}

/** How many design-level coordinator corrections one child may receive. */
export const MAX_COORDINATOR_CORRECTIONS = 2;
/** The park reason once a child exhausts its budget after its last correction. */
export const CORRECTION_LIMIT_REACHED = "batch_correction_limit_reached";

export const LANE_CONTRACT_MISMATCH = "batch_lane_contract_mismatch";
export const RUNTIME_CONTRACT_MISMATCH = "batch_runtime_contract_mismatch";

/**
 * The runtime a Lane Executor will load, when the coordinator can know it: an
 * explicit path, else the repository's own plugin source when the repository
 * is the Immune-Brain package itself (a Host loading the package from the
 * repository runs that source in every Lane, which is cut from this head).
 * Null when nothing can be compared.
 */
function laneRuntimeDir(root: string, explicit: string | undefined): string | null {
	if (explicit) return explicit;
	try {
		const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { name?: unknown };
		return manifest.name === "immune-brain" ? root : null;
	} catch {
		return null;
	}
}

/**
 * Batch-start preflight for lane mode: the coordinator reads every Lane's
 * Kernel state with its own runtime, so the runtime a Lane Executor loads must
 * use the same contract identifiers. The comparison is on those identifiers,
 * never on a plugin version number. A refusal names both sources; a match
 * returns null and adds nothing, no confirmation included.
 */
export function laneRuntimeContractRefusal(root: string, executorRuntime?: string, loadedFrom?: string): string | null {
	// Lane Executors on this Host load the coordinator's plugin build, so a build
	// that differs from the workspace plugin would run every Lane on stale
	// runtime code (Spec branch-boundary D4).
	const skew = pluginSourceSkewWarning(root, loadedFrom);
	if (skew) return `${RUNTIME_CONTRACT_MISMATCH}: ${skew.message}`;
	const dir = laneRuntimeDir(root, executorRuntime);
	if (!dir) return null;
	let lane: ReturnType<typeof readRuntimeContracts>;
	try {
		lane = readRuntimeContracts(dir);
	} catch (error) {
		return `${RUNTIME_CONTRACT_MISMATCH}: ${error instanceof Error ? error.message : String(error)}`;
	}
	if (!lane) return executorRuntime ? `${RUNTIME_CONTRACT_MISMATCH}: no runtime contract manifest under ${executorRuntime}` : null;
	const differences = runtimeContractDifferences(RUNTIME_CONTRACTS, lane.contracts);
	if (differences.length === 0) return null;
	return `${RUNTIME_CONTRACT_MISMATCH}: coordinator runtime ${runningRuntimeSource()} and Lane runtime ${lane.path} disagree (${differences.join("; ")}); load the same runtime on both sides before starting the batch`;
}

function laneUnreadableReason(error: string, taskId: string, runId: string | null | undefined): string {
	const category = /contract must equal|unknown field|schema version .* incompatible|unknown contract/i.test(error)
		? LANE_CONTRACT_MISMATCH : "batch_lane_unreadable";
	// Persist identity and stage, never arbitrary parser/IO exception bytes.
	return `${category}: ${JSON.stringify({ stage: "project_task", task_id: taskId, run_id: runId ?? null })}`;
}

async function readLaneProjection(input: StartBatchInput, path: string, taskId: string) {
	try {
		return await input.kernel.projectTask(path, taskId);
	} catch (error) {
		return { error: error instanceof Error ? error.message : String(error) } as Awaited<ReturnType<StartBatchInput["kernel"]["projectTask"]>>;
	}
}

/** The branch the Lane for a child must sit on. */
export function laneBranchName(initiativeSlug: string, taskId: string): string {
	return `imm-lane/${initiativeSlug}/${taskId}`;
}

export interface LaneFacts {
	/** The offered path resolves to an existing directory. */
	exists: boolean;
	real_path: string | null;
	/** The path is a worktree of the coordinator's repository (shared Git common directory). */
	same_repository: boolean;
	/** The path is the top level of its worktree, not a subdirectory. */
	is_worktree_root: boolean;
	branch: string | null;
	head: string | null;
	clean: boolean;
	active_claim_task_id: string | null;
}

/** Git operations lane mode needs beyond the serial port. */
export interface BatchLaneGitPort {
	inspectLane(coordinatorRoot: string, lanePath: string): LaneFacts;
	/** Coordinator root resolved the same way a Lane path is, for the identity comparison. */
	resolveRoot(root: string): string;
	integrate(input: {
		root: string;
		branch: string;
		batch_head: string;
		lane_base: string;
		lane_commit: string;
		declaration_head?: string;
		child: IntegrationCheckChild;
		siblings: Array<IntegrationCheckChild & { commit: string | null }>;
	}): Promise<{ commit: string }> | { commit: string };
	findIntegrated(input: {
		root: string;
		task_id: string;
		batch_id: string;
		branch?: string;
		from_head: string;
		declaration_head?: string;
		lane_base: string;
		lane_commit: string;
	}): string | null;
	/**
	 * The child's `.imm/audit/<task_id>/` terminal evidence pair is reachable
	 * from `head`. A Lane store is lost on release, so release is offered only
	 * when the tracked pair already survives on the batch branch.
	 */
	auditReachable(input: { root: string; head: string; task_id: string }): boolean;
}

function gitRead(root: string, args: string[]): { status: number | null; stdout: string } {
	const result = spawnSync("git", ["-C", root, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
	return { status: result.status, stdout: (result.stdout ?? "").trim() };
}

function commonDir(root: string): string | null {
	const result = gitRead(root, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
	if (result.status !== 0 || !result.stdout) return null;
	try {
		return realpathSync(result.stdout);
	} catch {
		return null;
	}
}

function resolveRealPath(path: string): string | null {
	try {
		return realpathSync(path);
	} catch {
		return null;
	}
}

export function createDefaultLaneGitPort(): BatchLaneGitPort {
	return {
		resolveRoot: (root) => resolveRealPath(root) ?? root,
		inspectLane(coordinatorRoot, lanePath) {
			const real = existsSync(lanePath) ? resolveRealPath(lanePath) : null;
			const absent: LaneFacts = {
				exists: real !== null,
				real_path: real,
				same_repository: false,
				is_worktree_root: false,
				branch: null,
				head: null,
				clean: false,
				active_claim_task_id: null,
			};
			if (!real) return absent;
			const laneCommon = commonDir(real);
			const coordinatorCommon = commonDir(coordinatorRoot);
			if (!laneCommon || !coordinatorCommon || laneCommon !== coordinatorCommon) return absent;
			const top = gitRead(real, ["rev-parse", "--show-toplevel"]);
			const topReal = top.status === 0 ? resolveRealPath(top.stdout) : null;
			const branch = gitRead(real, ["symbolic-ref", "--short", "HEAD"]);
			const head = gitRead(real, ["rev-parse", "HEAD"]);
			const status = gitRead(real, ["status", "--porcelain", "--untracked-files=all", "--ignore-submodules=none"]);
			let activeClaim: string | null = null;
			try {
				activeClaim = readActiveClaimTaskId(real);
			} catch {
				// An unreadable Lane store cannot be proved unoccupied.
				activeClaim = "unreadable";
			}
			return {
				exists: true,
				real_path: real,
				same_repository: true,
				is_worktree_root: topReal === real,
				branch: branch.status === 0 ? branch.stdout : null,
				head: head.status === 0 ? head.stdout : null,
				clean: status.status === 0 && status.stdout === "",
				active_claim_task_id: activeClaim,
			};
		},
		integrate: integrateGuardedLaneCommit,
		findIntegrated: findIntegratedCandidate,
		auditReachable({ root, head, task_id }) {
			const listing = gitRead(root, ["ls-tree", "-r", "--name-only", head, "--", `.imm/audit/${task_id}`]);
			if (listing.status !== 0) return false;
			const files = listing.stdout.split("\n");
			const runDirs = new Set(files.map((file) => file.slice(0, file.lastIndexOf("/"))));
			return [...runDirs].some(
				(dir) => files.includes(`${dir}/task-record.json`) && files.includes(`${dir}/terminal-proof.json`),
			);
		},
	};
}

/**
 * Decide one offer from the facts read about its path. Pure: a refusal reads
 * nothing more and writes nothing.
 */
export function decideLaneAdmission(input: {
	facts: LaneFacts;
	coordinator_real_path: string;
	expected_branch: string;
	batch_head: string;
	bound_paths: readonly string[];
}): LaneAdmissionReason | null {
	const { facts } = input;
	if (!facts.exists || !facts.real_path || !facts.same_repository || !facts.is_worktree_root)
		return "batch_lane_foreign_repository";
	if (facts.real_path === input.coordinator_real_path) return "batch_lane_is_coordinator";
	if (facts.branch !== input.expected_branch) return "batch_lane_branch_mismatch";
	if (facts.head !== input.batch_head) return "batch_lane_base_mismatch";
	if (!facts.clean) return "batch_lane_dirty";
	if (facts.active_claim_task_id !== null || input.bound_paths.includes(facts.real_path))
		return "batch_lane_occupied";
	return null;
}

function laneGitOf(input: StartBatchInput): BatchLaneGitPort {
	return (input.git as (BatchRunnerGitPort & { lane?: BatchLaneGitPort }) | undefined)?.lane ?? createDefaultLaneGitPort();
}

function serialGitOf(input: StartBatchInput): Pick<BatchRunnerGitPort, "preflight" | "commitChild" | "lookupBatchCommit" | "retainLaneEvidence"> {
	return input.git ?? defaultSerialGit();
}

/**
 * Release handoffs for integrated Lanes that are safe to remove: the Lane is
 * still present on its own branch, clean, and its audit pair already sits on
 * the batch branch. A parked, failed, dirty or unintegrated Lane never appears.
 * Read-only: the runtime asks the steward to remove a Lane and never does it.
 */
function releaseHandoffs(
	input: StartBatchInput,
	record: BatchLaneRunStateRecord,
	lanes: BatchLaneGitPort,
): BatchLaneHandoff[] {
	if (isParentBranch(record.branch)) return [];
	const lineage = classifyBatchLineage({ root: input.root, branch: record.branch ?? "",
		expectedHead: expectedBatchHead(record), childCommits: record.commits, batchId: record.batch_id });
	if (lineage.kind === "broken") return [];
	const handoffs: BatchLaneHandoff[] = [];
	for (const child of record.children) {
		if (child.state !== "integrated" || !child.lane) continue;
		const facts = lanes.inspectLane(input.root, child.lane.path);
		if (!facts.exists || !facts.same_repository || !facts.is_worktree_root || !facts.clean || facts.branch !== child.lane.branch || facts.active_claim_task_id !== null) continue;
		if (!lanes.auditReachable({ root: input.root, head: lineage.head, task_id: child.task_id })) continue;
		handoffs.push({ role: "lane-steward", action: "release", task_id: child.task_id, lane_branch: child.lane.branch });
	}
	return handoffs;
}

function defaultSerialGit(): BatchRunnerGitPort {
	return createDefaultBatchGitPort();
}

const IN_FLIGHT = new Set(["lane_admitted", "enrolled", "settled", "lane_committed"]);

function dependentsOf(record: BatchLaneRunStateRecord, taskId: string): BatchLaneChildRun[] {
	return record.children.filter((child) => child.blocked_by.includes(taskId));
}

function skipDependents(record: BatchLaneRunStateRecord, taskId: string, reason: string): void {
	const skip = new Set<string>([taskId]);
	const queue = [taskId];
	while (queue.length > 0) {
		const current = queue.shift()!;
		for (const dependent of dependentsOf(record, current)) {
			if (skip.has(dependent.task_id)) continue;
			skip.add(dependent.task_id);
			queue.push(dependent.task_id);
		}
	}
	record.children = record.children.map((child) =>
		skip.has(child.task_id) && child.state === "pending" ? { ...child, state: "skipped_blocked", reason } : child,
	);
}

function consumedSlots(record: BatchLaneRunStateRecord): number {
	return record.children.filter((child) => child.state !== "pending" && child.state !== "skipped_blocked").length;
}

/** The child's planning estimate; scheduling orders only by blocked_by. */
export function scopeOfChild(root: string, child: { task_id: string; intent_path: string | null }): string[] {
	try {
		return [...readTaskIntent(root, child.task_id, child.intent_path ?? undefined).intent.scope_hint];
	} catch {
		return ["**"];
	}
}

function scheduleView(input: StartBatchInput, record: BatchLaneRunStateRecord) {
	return record.children.map((child) => ({
		task_id: child.task_id,
		slice_id: child.slice_id,
		state: child.state,
		blocked_by: child.blocked_by,
		scope_hint: scopeOfChild(input.root, input.children.find((c) => c.task_id === child.task_id) ?? { task_id: child.task_id, intent_path: null }),
	}));
}

/** Recovery preserves the parked run and requires fresh literal-user authorization. */
const LANE_NEEDS_HUMAN_NEXT_ACTION =
	"The lane batch has stopped on a parked child and its Lane is kept. Resolve the child by hand; continuing needs a new Batch Authorization.";

const TERMINAL_NEXT_ACTIONS: Record<string, string> = {
	completed: "The batch integrated every enrollable child; review the commits and the tracker.",
	budget_stopped: "The child budget stopped new enrollments; re-confirm to continue under a new authorization.",
	failed: "A lineage failure stopped the batch; inspect the failing child and the branch state.",
	rejected: "The batch was rejected before any enrollment; correct the stated reason and re-confirm.",
	superseded: "The plan moved past this record and an explicit disposition retired it; it grants no handoff and no child delivery.",
	needs_human: LANE_NEEDS_HUMAN_NEXT_ACTION,
	running: "The batch is still running; no terminal report is due yet.",
	prepared: "The batch is prepared but not started.",
};

// Spec batch-resource-safety-s2 D1: no Host reports a trusted Executor exit, so
// the runtime never deletes or recreates a Lane it created.
export const LANE_RETAINED = "batch_lane_retained";
export const LANE_REDO_RETAINED = "batch_lane_redo_retained";
const NO_EXIT_EVIDENCE = "no Host reports a trusted Executor exit";

function redoRetained(cause: string | null | undefined): string {
	if (cause?.startsWith(`${LANE_REDO_RETAINED}:`)) return cause;
	return `${LANE_REDO_RETAINED}: ${NO_EXIT_EVIDENCE}, so the Lane, its branch and its files are kept and no redo Lane is created${cause ? ` (${cause})` : ""}`;
}

/** Integrated children whose runtime-created Lane is still present; delivery never implies cleanup. */
export function retainedLaneNotices(root: string, record: BatchLaneRunStateRecord, lanes: BatchLaneGitPort = createDefaultLaneGitPort()): NonNullable<BatchLaneRunReport["lane_refusals"]> {
	if (!isParentBranch(record.branch)) return [];
	return record.children
		.filter(child => child.state === "integrated" && child.lane && lanes.inspectLane(root, child.lane.path).exists)
		.map(child => ({ task_id: child.task_id, path: child.lane!.path,
			reason: `${LANE_RETAINED}: ${NO_EXIT_EVIDENCE}; the delivered Lane and every file in it are kept` }));
}

/** Delivery and cleanup are reported apart; only the user removes a retained Lane. */
export function retainedLaneAction(refusals: BatchLaneRunReport["lane_refusals"]): string {
	const count = refusals?.filter(r => r.reason.startsWith(`${LANE_RETAINED}:`)).length ?? 0;
	return count ? ` Cleanup was not performed: ${count} runtime-created Lane(s) are kept because ${NO_EXIT_EVIDENCE}. Stop each Lane's Executor, keep the files you need, then remove the Lane yourself; removing it does not enable an automatic redo.` : "";
}

/**
 * Spec branch-boundary D8: under a record that binds each child's authority
 * subject, a Lane whose sidecar now carries a different subject parks that
 * child before anything of it reaches the batch branch.
 * A scope-only or run-parameter revision keeps the subject and passes. A
 * record without the binding is left alone, so it still fails as plan_changed.
 */
function laneAuthorityChange(record: BatchLaneRunStateRecord, taskId: string, lanePath: string): string | null {
	const recorded = record.intent_identities?.[taskId];
	if (!recorded?.intent_authority_hash) return null;
	let read: ReturnType<typeof readTaskIntent>;
	try {
		read = readTaskIntent(lanePath, taskId, recorded.intent_path);
	} catch {
		return null;
	}
	if (intentAuthorityHash(read.intent) === recorded.intent_authority_hash) return null;
	return `batch_child_authority_changed: ${taskId}`;
}

type TrackerObservations = NonNullable<BatchLaneRunReport["tracker_observations"]>;


/**
 * Close the Child Issue of every integrated child not closed yet. Only the
 * coordinator does this, and only after integration: a Lane settlement writes
 * nothing to the tracker, and a parked or lost child is never integrated, so
 * its Issue stays open. The terminal event comes from the child's audit pair,
 * which integration brought onto the batch branch. A tracker failure never
 * changes batch or Kernel state; the next tick retries it, and a confirmed
 * close is recorded so it is never repeated.
 */
async function closeIntegratedIssues(
	input: StartBatchInput,
	record: BatchLaneRunStateRecord,
	persist: () => void,
): Promise<TrackerObservations> {
	const observations: TrackerObservations = [];
	if (!input.tracker) return observations;
	for (const child of record.children) {
		if ((child.state !== "integrated" && child.state !== "released") || child.tracker_closed) continue;
		let status: string;
		let message: string;
		try {
			const tombstone = await withBatchEvidence(input.root, record.branch, expectedBatchHead(record),
				root => readTaskTombstone(root, child.task_id));
			if (!tombstone || tombstone.lifecycle_status !== "terminal" || tombstone.terminal_lifecycle !== "done") {
				observations.push({ task_id: child.task_id, status: "retryable_failure", message: "integrated child has no done terminal proof on the batch branch" });
				continue;
			}
			({ status, message } = await input.tracker.markTerminal(input.root, {
				task_id: child.task_id,
				phase: "done",
				terminal_event_id: tombstone.terminal_event_id,
			}));
		} catch (error) {
			status = "retryable_failure";
			message = error instanceof Error ? error.message : String(error);
		}
		observations.push({ task_id: child.task_id, status, message });
		if (status !== "updated" && status !== "already_current") continue;
		record.children = record.children.map((c) => (c.task_id === child.task_id ? { ...c, tracker_closed: true } : c));
		persist();
	}
	return observations;
}

function laneReport(
	record: BatchLaneRunStateRecord,
	reason: string | null,
	nextAction: string,
	extra: { handoffs?: BatchLaneHandoff[]; refusals?: BatchLaneRunReport["lane_refusals"]; tracker?: TrackerObservations; final?: FinalVerificationReport; instruction?: BatchLaneRunReport["lane_instruction"] } = {},
): BatchLaneRunReport {
	return {
		contract: "assurance_kernel/batch_run_report/v1",
		batch_id: record.batch_id,
		initiative_slug: record.initiative_slug,
		batch_state: record.batch_state,
		max_parallel: record.max_parallel,
		children: record.children,
		commits: record.commits,
		reason,
		handoffs: extra.handoffs ?? [],
		...(extra.refusals?.length ? { lane_refusals: extra.refusals } : {}),
		...(extra.tracker?.length ? { tracker_observations: extra.tracker } : {}),
		...(record.restores?.length ? { restores: record.restores } : {}),
		...(extra.final ? { final_verification: extra.final } : {}),
		...(record.final_report ? { final_report: record.final_report } : {}),
		...(record.interventions?.length ? { interventions: record.interventions } : {}),
		...(extra.instruction ? { lane_instruction: extra.instruction } : {}),
		...(record.delegated_revisions?.length ? { delegated_revisions: record.delegated_revisions } : {}),
		...(record.reseals?.length ? { reseals: record.reseals } : {}),
		next_action: (nextAction || (record.final_report?.return_to_coordinator.status === "blocked"
			? `Review the final report; coordinator return stopped: ${record.final_report.return_to_coordinator.reason}. The Parent branch is retained.`
			: TERMINAL_NEXT_ACTIONS[record.batch_state] ?? "Inspect the batch run state.")) + retainedLaneAction(extra.refusals),
		created_at: record.updated_at,
	};
}

/** A store-condition rejection of a persisted lane batch: its persisted lane children, commits and parallelism, never an empty serial plan. */
export function laneRejectionReport(input: StartBatchInput, record: BatchLaneRunStateRecord, reason: string, nextAction: string): BatchLaneRunReport {
	// A rejected tick grants no execution or admission authority. Only already
	// integrated, unoccupied Lanes with surviving audit evidence may be released.
	const lanes = laneGitOf(input);
	const handoffs = releaseHandoffs(input, record, lanes);
	return laneReport({ ...record, batch_state: "rejected" }, reason,
		handoffs.length ? `${nextAction}. Check each release handoff with the Lane Steward.` : nextAction,
		{ handoffs, refusals: retainedLaneNotices(input.root, record, lanes) });
}

function finalizeLane(
	root: string,
	record: BatchLaneRunStateRecord,
	reason: string | null,
	nextAction: string,
	extra: Parameters<typeof laneReport>[3] = {},
): BatchLaneRunReport {
	const report = laneReport(record, reason, nextAction, extra);
	if (isTerminalBatchState(record.batch_state) || record.batch_state === "needs_human")
		writeBatchRunReport(root, report);
	return report;
}

/** A refusal before any write: the persisted record (or the prepared plan) reported as rejected. */
function refuse(
	input: StartBatchInput,
	persisted: AnyBatchRunStateRecord | null,
	code: string,
	detail: string,
): BatchLaneRunReport {
	const base =
		persisted && isLaneBatchRecord(persisted)
			? persisted
			: prepareBatchLaneRunState({
					batch_id: input.batch_id,
					initiative_slug: input.initiative_slug,
					children: persisted ? [] : input.children,
					plan_digest: input.plan_digest,
					base_head: input.base_head,
					confirmation_time: input.confirmation_time,
					budget: input.budget,
					max_parallel: input.max_parallel ?? 1,
					now: input.now,
				});
	return laneReport({ ...base, batch_state: "rejected" }, `${code}: ${detail}`, "Correct the lane-mode parameters and call start_unattended_batch again.");
}

function assertPlanMatches(input: StartBatchInput, record: BatchLaneRunStateRecord): void {
	const plan = input.registry.children(input.capability);
	if (
		record.plan_digest !== computeBatchPlanDigest(plan) ||
		record.children.length !== plan.length ||
		record.children.some((child, index) => {
			const expected = plan[index]!;
			return child.task_id !== expected.task_id || JSON.stringify(child.blocked_by) !== JSON.stringify(expected.blocked_by);
		})
	)
		throw new Error("plan_digest mismatch: persisted children do not match the authorized plan");
}

function validateNewAuthorization(input: StartBatchInput): string | null {
	try {
		const authorized = input.kernel.validateBatchAuthorization({
			registry: input.registry,
			capability: input.capability,
			binding: {
				batch_id: input.batch_id,
				plan_digest: input.plan_digest,
				base_head: input.base_head,
				initiative_slug: input.initiative_slug,
				budget: input.budget,
			},
		});
		if (authorized.issued_at !== input.confirmation_time)
			return "the parked batch requires a fresh literal-user confirmation";
		const children = input.children.map((child) => {
			const { intent_path, intent_revision, intent_content_hash } = child;
			if (intent_path === null || intent_revision === null || intent_content_hash === null)
				throw new Error(`batch child ${child.task_id} has no complete intent identity`);
			return { ...child, intent_path, intent_revision, intent_content_hash };
		});
		if (
			computeBatchPlanDigest(children) !== authorized.plan_digest ||
			input.plan_digest !== authorized.plan_digest ||
			input.base_head !== authorized.base_head
		)
			return "batch run input does not match the authorized plan or base_head";
		return null;
	} catch (error) {
		return error instanceof Error ? error.message : String(error);
	}
}

/** Durable redo spend, written by the integration redo coordinator (S2). */
export type BatchLaneRedoChildRun = BatchLaneChildRun;

/** Restore slots and redo spend together, including a granted redo not yet enrolled. */
export function rehydrateConsumption(input: StartBatchInput, record: BatchLaneRunStateRecord): void {
	const { issued_at: _issuedAt, ...binding } = input.kernel.validateBatchAuthorization({
		registry: input.registry,
		capability: input.capability,
		binding: {
			batch_id: record.batch_id,
			plan_digest: record.plan_digest,
			base_head: record.base_head,
			initiative_slug: record.initiative_slug,
			budget: record.budget,
		},
	});
	for (const child of record.children) {
		const recorded = (child as BatchLaneRedoChildRun).redo_grants;
		const grants = recorded === undefined ? 0 : recorded;
		const consumed = child.state !== "pending" && child.state !== "skipped_blocked" && child.state !== "lane_admitted" && !child.redo_head;
		if (!consumed && grants === 0) continue;
		input.registry.restoreChild(input.capability, binding, child.task_id, grants);
		if (!consumed) input.registry.releaseChild(input.capability, child.task_id);
	}
}

function failLineage(root: string, record: BatchLaneRunStateRecord, message: string): BatchLaneRunReport {
	const next: BatchLaneRunStateRecord = {
		...record,
		batch_state: "failed",
		children: record.children.map((child) =>
			IN_FLIGHT.has(child.state) ? { ...child, state: "needs_human" as const, reason: message } : child,
		),
	};
	for (const child of next.children) if (child.state === "needs_human") skipDependents(next, child.task_id, `dependency ${child.task_id} parked`);
	return finalizeLane(root, writeBatchLaneRunState(root, next), message, "");
}

function park(record: BatchLaneRunStateRecord, taskId: string, reason: string): void {
	record.children = record.children.map((child) =>
		child.task_id === taskId ? { ...child, state: "needs_human", reason } : child,
	);
	skipDependents(record, taskId, `dependency ${taskId} parked`);
}

function isLineageBreak(message: string): boolean {
	return message.includes("batch_head_lineage_broken");
}

/**
 * One lane-mode tick for a batch whose record is `persisted` (or new). Under
 * the existing batch lock; every step is idempotent against durable facts.
 */
export async function runLaneBatch(
	input: StartBatchInput,
	persisted: AnyBatchRunStateRecord | null,
): Promise<BatchLaneRunReport> {
	if (persisted && !isLaneBatchRecord(persisted))
		return { ...refuse(input, persisted, "batch_record_shape_retired", "v1 serial batch records are read-and-retire only"), next_action: "Inspect the recorded batch, then use retire_stale_batch for this Initiative in the current Host." };
	if (persisted && input.max_parallel !== undefined && input.max_parallel !== persisted.max_parallel)
		return refuse(input, persisted, PARALLEL_MISMATCH, `the recorded batch runs with max_parallel ${persisted.max_parallel}`);
	if (input.lane_offers !== undefined && (!persisted || isParentBranch(persisted.branch)))
		return refuse(input, persisted, "lane_offers_retired", "new batches create their own Lanes");
	const limit = persisted?.max_parallel ?? input.max_parallel ?? 1;
	if (!input.children.length) return refuse(input, persisted, "batch_plan_empty", "batch plan is empty");

	const git = serialGitOf(input);
	const lanes = laneGitOf(input);

	let record: BatchLaneRunStateRecord;
	if (persisted) {
		record = persisted;
		assertPlanMatches(input, record);
		// A durable binding is provenance, not permission to adopt a different checkout.
		if (isParentBranch(record.branch)) {
			const common = commonDir(input.root);
			for (const child of record.children) {
				if (!child.lane || child.state === "released") continue;
				const expectedPath = common ? join(common, "imm", "worktrees", record.initiative_slug, child.task_id) : null;
				const facts = lanes.inspectLane(input.root, child.lane.path);
				const bindingMatches = child.lane.path === expectedPath && child.lane.branch === laneBranchName(record.initiative_slug, child.task_id);
				const headMatches = facts.head && (facts.head === child.redo_head || (child.lane.lane_commit
					? facts.head === child.lane.lane_commit
					: gitRead(input.root, ["merge-base", "--is-ancestor", child.lane.base_head, facts.head]).status === 0));
				const checkoutMatches = facts.real_path === expectedPath && facts.same_repository && facts.is_worktree_root &&
					facts.branch === child.lane.branch && headMatches;
				if (!bindingMatches || (facts.exists && !checkoutMatches))
					return refuse(input, record, "batch_lane_identity_mismatch", `${child.task_id}: ${child.lane.path}; recorded Lane identity does not match; resource retained`);
			}
		}
		if (isTerminalBatchState(record.batch_state)) {
			// A close that failed on the completing tick is retried here; a terminal
			// record otherwise stays as it was.
			const tracker = record.batch_state === "completed"
				? await closeIntegratedIssues(input, record, () => { record = writeBatchLaneRunState(input.root, record); })
				: [];
			return finalizeLane(input.root, record, `terminal state already reached: ${record.batch_state}`, "", {
				handoffs: record.batch_state === "completed" ? releaseHandoffs(input, record, lanes) : [],
				refusals: retainedLaneNotices(input.root, record, lanes),
				tracker,
			});
		}
		if (record.batch_state === "needs_human") {
			const invalid = validateNewAuthorization(input);
			if (invalid || Date.parse(input.confirmation_time) <= Date.parse(record.confirmation_time))
				return laneReport(record, invalid ?? "the parked batch requires a fresh literal-user confirmation", LANE_NEEDS_HUMAN_NEXT_ACTION);
			const resumed: BatchLaneChildRun[] = [];
			for (const child of record.children) {
				if (child.state !== "needs_human") { resumed.push(child); continue; }
				if (!child.lane?.run_id) { resumed.push(child); continue; }
				// A durable grant already passed the fresh-confirmation boundary.
				if (child.redo_head) { resumed.push(child); continue; }
				const facts = lanes.inspectLane(input.root, child.lane.path);
				const fresh = await readLaneProjection(input, child.lane.path, child.task_id);
				const owned = !facts.exists || (facts.same_repository && facts.is_worktree_root && facts.branch === child.lane.branch);
				const readable = fresh.error === null;
				const unreadable = !readable && laneUnreadableReason(fresh.error!, child.task_id, child.lane.run_id).startsWith("batch_lane_unreadable:");
				if (!owned || (readable && facts.exists && (fresh.projection.run_id !== child.lane.run_id ||
					fresh.projection.open_user_decision_count > 0 || fresh.projection.replan_required_ids.length > 0))) {
					resumed.push(child); continue;
				}
				// A missing, unreadable or stopped Lane is not exit evidence: it is never revived in place.
				if (isParentBranch(record.branch) && (!facts.exists || unreadable || (readable && fresh.projection.lifecycle === "stopped"))) {
					resumed.push({ ...child, reason: redoRetained(child.reason) }); continue;
				}
				if (!readable || !facts.exists) { resumed.push(child); continue; }
				const state = fresh.projection.lifecycle === "done" && fresh.projection.completion_ready ?
					(child.lane.lane_commit ? "lane_committed" : "settled") :
					fresh.projection.lifecycle === "active" && fresh.claim?.task_id === child.task_id &&
					(facts.active_claim_task_id === null || facts.active_claim_task_id === child.task_id) ? "enrolled" : null;
				if (!state) { resumed.push(child); continue; }
				const authorityChange = state === "lane_committed" ? laneAuthorityChange(record, child.task_id, child.lane.path) : null;
				if (authorityChange) {
					resumed.push({ ...child, reason: authorityChange });
					continue;
				}
				resumed.push({ ...child, state, reason: null, qa_failures: 0 });
			}
			record = { ...record, batch_state: "running", children: resumed.map(child => {
				const next = child.state === "skipped_blocked" ? { ...child, state: "pending" as const, reason: null } : child;
				// The fresh confirmation is the user's answer to a runtime reload pause.
				return next.runtime_reload?.state === "required" ? { ...next, runtime_reload: { ...next.runtime_reload, state: "acknowledged" as const } } : next;
			}) };
			for (const child of record.children) if (child.state === "needs_human")
				skipDependents(record, child.task_id, `dependency ${child.task_id} parked`);
		}
	} else {
		const invalid = validateNewAuthorization(input);
		if (invalid) return refuse(input, null, "batch_authorization_invalid", invalid);
		const contractRefusal = laneRuntimeContractRefusal(input.root, input.executor_runtime);
		if (contractRefusal) {
			const [code, ...detail] = contractRefusal.split(": ");
			return refuse(input, null, code!, detail.join(": "));
		}
		try {
			for (const child of input.children) assertLaneWorktreeAvailable(input.root, input.initiative_slug, child.task_id);
		} catch (error) {
			return refuse(input, null, "batch_lane_collision", error instanceof Error ? error.message : String(error));
		}
		const preflight = await git.preflight({
			root: input.root,
			initiative_slug: input.initiative_slug,
			base_head: input.base_head,
			batch_id: input.batch_id,
			blocking_scopes: unsettledChildScopes(input.root, input.children),
			progress_mode: "parent_branch",
		});
		if (!preflight.ok) return refuse(input, null, preflight.reason, preflight.message || "Correct the preflight condition and re-confirm.");
		record = prepareBatchLaneRunState({
			topology_digest: input.topology_digest,
			batch_id: input.batch_id,
			initiative_slug: input.initiative_slug,
			children: input.children,
			plan_digest: input.plan_digest,
			base_head: input.base_head,
			branch: preflight.branch,
			...(isParentBranch(preflight.branch) ? { progress_mode: "parent_branch" as const } : {}),
			confirmation_time: input.confirmation_time,
			budget: input.budget,
			max_parallel: limit,
			now: input.now,
			...(input.final_verification?.length ? { final_verification: input.final_verification } : {}),
		});
	}

	const persist = (): void => {
		record = writeBatchLaneRunState(input.root, record);
	};
	// Lane writes that leaked into the coordinator checkout, restored only now,
	// after authorization, and only when every dirty path is provably a Lane's.
	if (persisted && !isParentBranch(record.branch)) {
		const entries = porcelainEntries(input.root);
		if (entries && entries.length > 0) {
			const outcome = restoreProvableLaneLeaks(input.root, record, entries, input.now);
			if (outcome.kind === "restored") {
				record.restores = [...(record.restores ?? []), outcome.restore];
				persist();
			}
		}
	}
	// A resumed park is persisted only after the existing lineage validation below.
	const resumedPark = persisted?.batch_state === "needs_human" && record.batch_state === "running";
	if (record.batch_state === "prepared") {
		record.batch_state = "running";
		persist();
	}

	// Adopt an integration the previous tick completed but did not record.
	for (const child of record.children) {
		if (child.state !== "lane_committed" || child.redo_head || !child.lane?.lane_commit) continue;
		const found = lanes.findIntegrated({
			root: input.root,
			task_id: child.task_id,
			batch_id: record.batch_id,
			...(record.branch ? { branch: record.branch } : {}),
			from_head: expectedBatchHead(record),
			declaration_head: record.base_head,
			lane_base: child.lane.base_head,
			lane_commit: child.lane.lane_commit,
		});
		if (!found) continue;
		await git.retainLaneEvidence?.({ root: input.root, taskId: child.task_id, batchId: record.batch_id,
			branch: record.branch, lane: { ...child.lane, lane_commit: child.lane.lane_commit, integrated_commit: found } });
		record.children = record.children.map((c) => (c.task_id === child.task_id ? { ...c, state: "integrated", commit: found } : c));
		record.commits = [...record.commits, found];
		persist();
	}

	// Record a release once the Lane path is observed gone. The commit and the
	// Lane binding stay; an integrated child whose Lane is still present is left
	// integrated, and a terminal record is never rewritten.
	for (const child of record.children) {
		if (child.state !== "integrated" || !child.lane) continue;
		if (lanes.inspectLane(input.root, child.lane.path).exists) continue;
		record.children = record.children.map((c) => (c.task_id === child.task_id ? { ...c, state: "released" } : c));
		persist();
	}

	const lineage = existsSync(join(input.root, ".git"))
		? classifyBatchLineage({
				root: input.root,
				branch: record.branch ?? "",
				expectedHead: expectedBatchHead(record),
				childCommits: record.commits,
				batchId: record.batch_id,
			})
		: ({ kind: "equal", head: expectedBatchHead(record) } as const);
	if (lineage.kind === "broken") return failLineage(input.root, record, lineage.message);
	if (lineage.kind === "fast_forward") {
		record = writeBatchLaneRunState(input.root, {
			...record,
			adopted_heads: [...(record.adopted_heads ?? []), { from: expectedBatchHead(record), to: lineage.head }],
		});
	}

	try {
		rehydrateConsumption(input, record);
	} catch (error) {
		return failLineage(input.root, record, error instanceof Error ? error.message : String(error));
	}

	if (resumedPark) {
		record = { ...record, confirmation_time: input.confirmation_time };
		persist();
	}
	// A coordinator instruction is recorded before the Parent sends it, and only
	// when it may be sent; the report tells the Parent which.
	let instruction: BatchLaneRunReport["lane_instruction"];
	if (input.lane_instruction) {
		const request = input.lane_instruction;
		const refusal = decideLaneInstruction(record, request);
		if (refusal) instruction = { task_id: request.task_id, kind: request.kind, accepted: false, reason: `batch_lane_instruction_refused: ${refusal}` };
		else {
			if (request.kind === "correction")
				record.children = record.children.map((c) => {
					if (c.task_id !== request.task_id) return c;
					const { correction_due: _due, ...rest } = c;
					return { ...rest, corrections: (c.corrections ?? 0) + 1, qa_failures: 0 };
				});
			record.interventions = [...(record.interventions ?? []), {
				at: input.now,
				task_id: request.task_id,
				kind: request.kind,
				text: request.text,
				text_digest: `sha256:${createHash("sha256").update(request.text).digest("hex")}`,
			}];
			persist();
			instruction = { task_id: request.task_id, kind: request.kind, accepted: true, reason: null };
		}
	}
	const refusals: NonNullable<BatchLaneRunReport["lane_refusals"]> = [];

	// A parked child ends only itself and its dependents; the batch keeps moving
	// for every scope-disjoint sibling and settles needs_human at the end of the
	// tick, when nothing is in flight and nothing can start.
	let parkedMessage: string | null = null;
	const reviewOpen: string[] = [];
	const parkChild = (taskId: string, reason: string): void => {
		park(record, taskId, reason);
		parkedMessage ??= reason;
		persist();
	};
	const enrollInLane = async (taskId: string): Promise<BatchLaneRunReport | null> => {
		const lane = record.children.find((c) => c.task_id === taskId)!.lane!;
		try {
			if (isParentBranch(record.branch)) copyLanePlanningInput(input.root, lane.path, taskId, "intent");
			await input.kernel.enrollTask({
				root: lane.path,
				task_id: taskId,
				batch: { registry: input.registry, capability: input.capability, binding: { batch_id: record.batch_id, expected_head: lane.base_head } },
			});
			// Deliver the bound Spec after Enrollment so it is task work, not baseline user dirt.
			if (isParentBranch(record.branch)) copyLanePlanningInput(input.root, lane.path, taskId, "spec");
			const fresh = await readLaneProjection(input, lane.path, taskId);
			if (fresh.error !== null) throw new Error(laneUnreadableReason(fresh.error, taskId, lane.run_id));
			if (!fresh.projection.run_id || fresh.claim?.task_id !== taskId)
				throw new Error("enrolled Lane has no observable owned run");
			record.children = record.children.map((c) => (c.task_id === taskId ? { ...c, state: "enrolled", reason: null, lane: { ...lane, run_id: fresh.projection.run_id } } : c));
			persist();
			return null;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			parkChild(taskId, message);
			if (!isLineageBreak(message)) return null;
			// A broken lineage cannot be trusted for any other child either.
			record.batch_state = "failed";
			persist();
			return finalizeLane(input.root, record, message, "", { refusals });
		}
	};

	// Spec branch-boundary-r2-followups D9: a child integrated a plugin build this
	// coordinator, and every Lane Executor loading it, does not run. No new Lane is
	// created until a fresh resume answers the pause; in-flight Lanes keep running.
	let reloadRequired: string | null = null;
	const runtimeAdmission = (taskId: string): { admit: boolean; acknowledged?: BatchLaneChildRun["runtime_skew_acknowledged"] } => {
		if (!isParentBranch(record.branch)) return { admit: true };
		const skew = parentRuntimeSkew(input.root, expectedBatchHead(record), record.commits);
		if (!skew) return { admit: true };
		// One acknowledged pause answers this build for every child of the batch.
		if (record.children.some(c => c.runtime_reload?.state === "acknowledged" && c.runtime_reload.parent_bundle === skew.parent_bundle))
			return { admit: true, acknowledged: skew };
		const gate = record.children.find(c => c.task_id === taskId)?.runtime_reload;
		if (gate?.state !== "required" || gate.parent_bundle !== skew.parent_bundle) {
			record.children = record.children.map(c => c.task_id === taskId
				? { ...c, runtime_reload: { commit: skew.commit, parent_bundle: skew.parent_bundle, state: "required" } } : c);
			persist();
		}
		reloadRequired ??= `runtime_reload_required: integrated commit ${skew.commit} changed the plugin build that this coordinator and its Lane Executors load`;
		return { admit: false };
	};
	const settledAt = (child: BatchLaneChildRun): string =>
		readTaskTombstone(child.lane!.path, child.task_id)?.terminalized_at ?? input.now;
	const queue = (): BatchLaneChildRun[] => [...record.children].sort((a, b) =>
		(a.settled_at ?? record.created_at).localeCompare(b.settled_at ?? record.created_at));
	// A redo target recorded before retention stays durable; its Lane is never recreated.
	for (const child of record.children) {
		if ((child.state !== "lane_committed" && child.state !== "needs_human") || !child.redo_head) continue;
		if (child.state === "needs_human" && child.reason?.startsWith(`${LANE_REDO_RETAINED}:`)) continue;
		parkChild(child.task_id, redoRetained(child.reason));
	}

	// 1. Observe every in-flight Lane and drive each frozen child's QA and Review.
	// Nothing is inferred from terminal text; only Kernel facts move a child.
	for (const child of [...record.children]) {
		if ((child.state !== "lane_admitted" && child.state !== "enrolled") || !child.lane) continue;
		const fresh = await readLaneProjection(input, child.lane.path, child.task_id);
		if (fresh.error !== null) {
			parkChild(child.task_id, laneUnreadableReason(fresh.error, child.task_id, child.lane.run_id));
			continue;
		}
		if (child.lane.run_id && fresh.projection.run_id !== child.lane.run_id) {
			parkChild(child.task_id, "batch_lane_run_mismatch");
			continue;
		}
		const holdsClaim = fresh.claim !== null && fresh.claim.task_id === child.task_id;
		const authorityChange = child.state === "enrolled" ? laneAuthorityChange(record, child.task_id, child.lane.path) : null;
		if (authorityChange) {
			parkChild(child.task_id, authorityChange);
			continue;
		}
		if (child.state === "lane_admitted") {
			// A crash between admission and enrollment adopts an existing claim or enrolls now.
			if (holdsClaim) {
				if (isParentBranch(record.branch)) copyLanePlanningInput(input.root, child.lane.path, child.task_id, "spec");
				record.children = record.children.map((c) =>
					c.task_id === child.task_id ? { ...c, state: "enrolled", reason: "adopted existing lane claim after interruption", lane: { ...child.lane!, run_id: fresh.projection.run_id } } : c,
				);
				persist();
			} else {
				const failed = await enrollInLane(child.task_id);
				if (failed) return failed;
			}
			continue;
		}
		if (fresh.projection.lifecycle === "done" && fresh.projection.completion_ready) {
			record.children = record.children.map((c) => (c.task_id === child.task_id ? { ...c, state: "settled", reason: null, settled_at: settledAt(child) } : c));
			persist();
			continue;
		}
		if (!holdsClaim) {
			parkChild(child.task_id, "batch_lane_lost");
			continue;
		}
		if (!input.kernel.ownsTaskClaim(child.task_id)) {
			parkChild(child.task_id, "claim held by another batch");
			continue;
		}
		// A child waiting for its coordinator correction gets no further attempt.
		if (child.correction_due) continue;
		// An unfrozen child, or one with QA pending the Executor's own attempt,
		// is the Executor's to move; the batch never reruns that attempt.
		if (fresh.projection.next_obligation === "run_qa" || fresh.projection.artifact_state !== "frozen") continue;
		const terminal = await input.kernel.advanceTask(child.lane.path, child.task_id);
		if (terminal.state === "completed") {
			record.children = record.children.map((c) =>
				c.task_id === child.task_id ? { ...c, state: "settled", reason: null, qa_failures: 0, settled_at: settledAt(child) } : c,
			);
			persist();
		} else if (terminal.state === "review_ready") {
			// The reservation lives in this Lane's own session store; the other Lanes'
			// children keep moving while it stays open.
			record.children = record.children.map((c) =>
				c.task_id === child.task_id ? { ...c, reason: `review reservation ${terminal.operation_id} open` } : c,
			);
			persist();
			reviewOpen.push(child.task_id);
		} else if (terminal.state === "rework" && terminal.operation === "qa") {
			const failures = child.qa_failures + 1;
			if (failures >= record.budget.qa_failure_limit) {
				const reason = "QA failure limit reached";
				const used = child.corrections ?? 0;
				if (used < MAX_COORDINATOR_CORRECTIONS) {
					// Hand the design judgment to the coordinator instead of parking: one
					// correction, sent to a new Lane session, before any further attempt.
					record.children = record.children.map((c) =>
						c.task_id === child.task_id ? { ...c, qa_failures: failures, correction_due: reason } : c,
					);
					persist();
					continue;
				}
				const parked = `${CORRECTION_LIMIT_REACHED}: ${reason} after ${used} coordinator corrections`;
				record.children = record.children.map((c) => {
					if (c.task_id !== child.task_id) return c;
					const { correction_due: _due, ...rest } = c;
					return { ...rest, state: "needs_human", reason: parked, qa_failures: failures };
				});
				skipDependents(record, child.task_id, `dependency ${child.task_id} parked`);
				parkedMessage ??= parked;
				persist();
				continue;
			}
			record.children = record.children.map((c) => (c.task_id === child.task_id ? { ...c, qa_failures: failures } : c));
			persist();
		} else if (
			terminal.state === "rework" ||
			terminal.environment_failure ||
			terminal.state === "review_preparation_failed" ||
			terminal.recovery?.category === "repair"
		) {
			// Ordinary own-claim repair stays with the Executor; the handoff below names it.
			continue;
		} else {
			const reason = terminal.state === "stopped" ? "Kernel reported the child stopped" : terminal.reason;
			parkChild(child.task_id, reason);
		}
	}

	// 2. Commit and integrate serially in Kernel settlement order, not plan order.
	for (const child of queue()) {
		if (child.state !== "settled" || !child.lane) continue;
		const authorityChange = laneAuthorityChange(record, child.task_id, child.lane.path);
		if (authorityChange) {
			parkChild(child.task_id, authorityChange);
			continue;
		}
		const planChild = input.children.find((c) => c.task_id === child.task_id);
		let laneCommit: string;
		try {
			const existing = await git.lookupBatchCommit(child.lane.path, child.task_id, record.batch_id, child.lane.base_head, child.lane.branch);
			laneCommit =
				existing?.commit ??
				(
					await git.commitChild(
						child.lane.path,
						child.task_id,
						record.batch_id,
						child.lane.base_head,
						child.lane.branch,
						planChild?.intent_path ?? undefined,
					)
				).commit;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			parkChild(child.task_id, message);
			if (!isLineageBreak(message)) continue;
			record.batch_state = "failed";
			persist();
			return finalizeLane(input.root, record, message, "");
		}
		record.children = record.children.map((c) =>
			c.task_id === child.task_id && c.lane ? { ...c, state: "lane_committed", lane: { ...c.lane, lane_commit: laneCommit } } : c,
		);
		persist();
	}
	for (const child of queue()) {
		if (child.state !== "lane_committed" || child.redo_head || !child.lane?.lane_commit) continue;
		const authorityChange = laneAuthorityChange(record, child.task_id, child.lane.path);
		if (authorityChange) {
			parkChild(child.task_id, authorityChange);
			continue;
		}
		const intentPathOf = (taskId: string) => input.children.find((c) => c.task_id === taskId)?.intent_path ?? null;
		try {
			const { commit } = await lanes.integrate({
				root: input.root,
				branch: record.branch ?? "",
				batch_head: expectedBatchHead(record),
				declaration_head: record.base_head,
				lane_base: child.lane.base_head,
				lane_commit: child.lane.lane_commit,
				child: { task_id: child.task_id, intent_path: intentPathOf(child.task_id) },
				siblings: record.children
					.filter((c) => (c.state === "integrated" || c.state === "released") && c.task_id !== child.task_id)
					.map((c) => ({ task_id: c.task_id, intent_path: intentPathOf(c.task_id), commit: c.commit })),
			});
			await git.retainLaneEvidence?.({ root: input.root, taskId: child.task_id, batchId: record.batch_id,
				branch: record.branch, lane: { ...child.lane, lane_commit: child.lane.lane_commit, integrated_commit: commit } });
			record.children = record.children.map((c) => (c.task_id === child.task_id ? { ...c, state: "integrated", commit, reason: null } : c));
			record.commits = [...record.commits, commit];
			persist();
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			const reason = error instanceof BatchIntegrationError ? error.reason : "batch_integration_conflict";
			const conflict = error instanceof BatchIntegrationError &&
				(reason === "batch_integration_conflict" || reason === "batch_integration_check_failed");
			// Spec batch-resource-safety-s2 D2: a conflict redo would replace this Lane; park it, spending no grant.
			if (isParentBranch(record.branch) && conflict) {
				parkChild(child.task_id, redoRetained(message.startsWith(`${reason}:`) ? message : `${reason}: ${message}`));
				continue;
			}
			parkChild(child.task_id, isLineageBreak(message) || message.startsWith(`${reason}:`) ? message : `${reason}: ${message}`);
			if (isLineageBreak(message)) {
				// A broken lineage cannot be trusted for any later integration.
				record.batch_state = "failed";
				persist();
				return finalizeLane(input.root, record, message, "");
			}
			// The batch branch is unmoved; a disjoint sibling may still integrate.
		}
	}

	// Close each integrated child's Issue now that its commit is on the batch branch.
	const tracker = await closeIntegratedIssues(input, record, persist);

	// New records create their Lanes but never remove them; legacy records still admit offered paths.
	refusals.push(...retainedLaneNotices(input.root, record, lanes));
	// 3. Admit runtime-created Lanes (or legacy offers), then enroll each child.
	const offers = [...(input.lane_offers ?? [])];
	let skewAcknowledged: BatchLaneChildRun["runtime_skew_acknowledged"];
	if (isParentBranch(record.branch)) {
		for (const taskId of startableChildren(scheduleView(input, record), limit)) {
			if (consumedSlots(record) + offers.length >= record.budget.max_children) break;
			if (input.kernel.canStartTask && !await input.kernel.canStartTask(taskId)) continue;
			if (!offers.length) {
				const runtime = runtimeAdmission(taskId);
				if (!runtime.admit) break;
				skewAcknowledged = runtime.acknowledged;
			}
			try { offers.push({ task_id: taskId, path: createLaneWorktree(input.root, record.initiative_slug, taskId, expectedBatchHead(record)) }); }
			catch (error) { parkChild(taskId, error instanceof Error ? error.message : String(error)); }
		}
	}
	const coordinatorReal = lanes.resolveRoot(input.root);
	for (const offer of offers) {
		const startable = new Set(startableChildren(scheduleView(input, record), limit));
		const child = record.children.find((c) => c.task_id === offer.task_id);
		if (!child || child.state !== "pending" || !startable.has(child.task_id)) {
			refusals.push({ ...offer, reason: "batch_lane_unknown_child" });
			continue;
		}
		if (input.kernel.canStartTask && !await input.kernel.canStartTask(offer.task_id)) {
			refusals.push({ ...offer, reason: "Parent prerequisite is not integrated" });
			continue;
		}
		const head = expectedBatchHead(record);
		const facts = lanes.inspectLane(input.root, offer.path);
		const reason = decideLaneAdmission({
			facts,
			coordinator_real_path: coordinatorReal,
			expected_branch: laneBranchName(record.initiative_slug, child.task_id),
			batch_head: head,
			bound_paths: record.children.flatMap((c) => (c.lane && c.state !== "released" ? [c.lane.path] : [])),
		});
		if (reason) {
			refusals.push({ ...offer, reason });
			continue;
		}
		// The child budget stops new admissions only; in-flight Lanes finish.
		if (consumedSlots(record) >= record.budget.max_children) break;
		const lane = { path: facts.real_path!, branch: laneBranchName(record.initiative_slug, child.task_id), base_head: head, lane_commit: null };
		record.children = record.children.map((c) => (c.task_id === child.task_id ? { ...c, state: "lane_admitted", lane,
			...(skewAcknowledged ? { runtime_skew_acknowledged: skewAcknowledged } : {}) } : c));
		persist();
		const failed = await enrollInLane(child.task_id);
		if (failed) return failed;
	}

	// 4. Schedule and report. Handoffs are observations, never readiness.
	if (record.children.every((c) => c.state === "integrated" || c.state === "released")) {
		// Full verification of the integrated batch branch, before the immutable
		// completion report is written. A failure is reported, never rolled back.
		// A hidden-ref batch leaves its delivery in the user's working tree, so the check is
		// bound to the children's scoped content rather than to a clean tree at HEAD.
		const final = record.final_verification?.length || readDerivedFilesAt(input.root, record.base_head).length
			? await runFinalVerification(input.root, record.final_verification ?? [],
				{ declaration_head: record.base_head, ...(isParentBranch(record.branch) ? { parent_head: expectedBatchHead(record) } :
				isBatchRef(record.branch) ? { scopes: unsettledChildScopes(input.root, input.children) } : {}) })
			: undefined;
		if (isParentBranch(record.branch)) {
			record.final_report = await buildBatchFinalReport(input.root, { ...record, final_verification_result: final });
			persist(); // Keep the report even if the return step is interrupted.
			record.final_report.return_to_coordinator = returnBatchToCoordinator(input.root, record.final_report.head, final ?? null);
		}
		record.batch_state = "completed";
		if (final) record.final_verification_result = final;
		persist();
		return finalizeLane(
			input.root,
			record,
			final && !final.passed
				? `all enrollable children integrated; final verification did not pass: ${[...final.results, ...(final.derived_checks ?? [])].filter((r) => !r.passed).map((r) => r.command).join(", ")}`
				: final ? "all enrollable children integrated" : "final verification not run",
			final && !final.passed
				? "Every child is integrated but the batch did not pass its final verification; inspect the failing commands against the delivered content. Integrated commits were not rolled back."
				: "",
			{ handoffs: releaseHandoffs(input, record, lanes), refusals, tracker, instruction, ...(final ? { final } : {}) },
		);
	}
	const handoffs: BatchLaneHandoff[] = [];
	for (const child of record.children) {
		if (child.state !== "enrolled" || !child.lane) continue;
		if (child.correction_due) {
			// No further Executor attempt until the coordinator's correction is recorded.
			handoffs.push({
				role: "coordinator",
				action: "correct",
				task_id: child.task_id,
				reason: child.correction_due,
				corrections_used: child.corrections ?? 0,
				corrections_left: MAX_COORDINATOR_CORRECTIONS - (child.corrections ?? 0),
				lane_path: child.lane.path,
			});
			continue;
		}
		const fresh = await readLaneProjection(input, child.lane.path, child.task_id);
		if (fresh.error !== null) {
			parkChild(child.task_id, laneUnreadableReason(fresh.error, child.task_id, child.lane.run_id));
			continue;
		}
		handoffs.push({
			role: "executor",
			task_id: child.task_id,
			run_id: fresh.projection.run_id ?? null,
			record_revision: fresh.projection.record_revision,
			next_obligation: fresh.projection.next_obligation,
			lane_branch: child.lane.branch,
			lane_path: child.lane.path,
		});
	}
	handoffs.push(...releaseHandoffs(input, record, lanes));
	const blocked = blockedByParked(scheduleView(input, record));
	record.children = record.children.map((child) => blocked.has(child.task_id)
		? { ...child, state: "skipped_blocked", reason: `dependency ${blocked.get(child.task_id)} parked` } : child);
	const inFlight = record.children.filter((c) => IN_FLIGHT.has(c.state));
	const startable = startableChildren(scheduleView(input, record), limit);
	const overBudget = consumedSlots(record) >= record.budget.max_children;
	if (reloadRequired) {
		// The pause holds admission and redo only; in-flight Executors keep running
		// and their Lanes are integrated after the fresh resume.
		record.batch_state = "needs_human";
		record.final_report = await buildBatchFinalReport(input.root, record);
		record.final_report.return_to_coordinator.reason = "children_not_integrated";
		persist();
		return finalizeLane(input.root, record, reloadRequired,
			"Reload the Host so it loads the Parent tip's plugin build (Claude Code: /mcp reconnect; Pi: /reload), then resume the batch with a fresh literal-user confirmation. A resume without reload admits the child with runtime_skew_acknowledged recorded.",
			{ handoffs, refusals, tracker, instruction });
	}
	if (!inFlight.length && (!startable.length || overBudget)) {
		const parked = record.children.some((c) => c.state === "needs_human" || c.state === "skipped_blocked");
		record.batch_state = parked ? "needs_human" : overBudget ? "budget_stopped" : "needs_human";
		if (isParentBranch(record.branch)) {
			record.final_report = await buildBatchFinalReport(input.root, record);
			record.final_report.return_to_coordinator.reason = "children_not_integrated";
		}
		persist();
		return finalizeLane(
			input.root,
			record,
			parkedMessage ?? (parked ? "a parked child needs a human decision" : overBudget ? `max_children budget exhausted (${record.budget.max_children})` : "no child can start"),
			"",
			{ refusals, tracker, instruction },
		);
	}
	if (!overBudget && !isParentBranch(record.branch)) {
		for (const taskId of startable) {
			handoffs.push({
				role: "lane-steward",
				action: "provision",
				task_id: taskId,
				lane_branch: laneBranchName(record.initiative_slug, taskId),
				base_head: expectedBatchHead(record),
				executor_hosts: LANE_EXECUTOR_HOSTS,
			});
		}
	}
	if (reviewOpen.length > 0) {
		return laneReport(
			record,
			reviewOpen.length === 1
				? `child ${reviewOpen[0]} holds an open Review reservation`
				: `children ${reviewOpen.join(", ")} hold open Review reservations`,
			"Submit each reserved foreground Review verdict in its own Lane, then call start_unattended_batch again to continue.",
			{ handoffs, refusals, tracker, instruction },
		);
	}
	return laneReport(
		record,
		null,
		handoffs.some((h) => h.role === "coordinator")
			? "For each coordinator handoff, read every round's findings in that Lane, start a new Lane session and send one design-level correction as lane_instruction kind correction; run the other handoffs as usual."
			: handoffs.some((h) => h.role === "lane-steward" && h.action === "provision")
				? "Provide a Lane for each provision handoff, then call start_unattended_batch again with lane_offers."
				: "Run each executor handoff in its Lane. When a Lane finishes, call start_unattended_batch again with the same Initiative.",
		{ handoffs, refusals, tracker, instruction },
	);
}
