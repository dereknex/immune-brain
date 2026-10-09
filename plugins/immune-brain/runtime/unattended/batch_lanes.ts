// Lane-mode batch driver. With `max_parallel` given, an unattended batch runs
// each child in a Lane: a separate worktree on its own branch, supplied by
// someone else, with its own Authority Store. This module admits offered Lanes,
// enrolls children into them, commits their settled delivery on the lane branch
// and integrates it into the batch branch. It never creates, switches or
// deletes a Git worktree and never names a workspace tool.
// Defined by docs/specs/parallel-batch-lanes.spec.md and ADR 0013.
import { spawnSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { computeBatchPlanDigest } from "../kernel/batch_authority";
import { readTaskIntent } from "../kernel/intent";
import type { StartBatchInput } from "./batch_runner";
import {
	BatchIntegrationError,
	findIntegratedCandidate,
	integrateGuardedLaneCommit,
	type IntegrationCheckChild,
} from "./batch_integration";
import { classifyBatchLineage, expectedBatchHead, readActiveClaimTaskId } from "./batch_preflight";
import { startableChildren } from "./batch_schedule";
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
		child: IntegrationCheckChild;
		siblings: Array<IntegrationCheckChild & { commit: string | null }>;
	}): Promise<{ commit: string }> | { commit: string };
	findIntegrated(input: {
		root: string;
		task_id: string;
		batch_id: string;
		from_head: string;
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

function serialGitOf(input: StartBatchInput): Pick<BatchRunnerGitPort, "preflight" | "commitChild" | "lookupBatchCommit"> {
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
	const handoffs: BatchLaneHandoff[] = [];
	for (const child of record.children) {
		if (child.state !== "integrated" || !child.lane) continue;
		const facts = lanes.inspectLane(input.root, child.lane.path);
		if (!facts.exists || !facts.same_repository || !facts.clean || facts.branch !== child.lane.branch) continue;
		if (!lanes.auditReachable({ root: input.root, head: expectedBatchHead(record), task_id: child.task_id })) continue;
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

/**
 * The scope a child's delivery may touch, read from its published TaskIntent at
 * the coordinator. A child whose scope cannot be read is treated as overlapping
 * everything, so an unreadable intent serializes instead of running in parallel.
 */
function scopeOfChild(root: string, child: { task_id: string; intent_path: string | null }): string[] {
	try {
		return [...readTaskIntent(root, child.task_id, child.intent_path ?? undefined).intent.scope_hint];
	} catch {
		return ["**"];
	}
}

function scheduleView(input: StartBatchInput, record: BatchLaneRunStateRecord) {
	return record.children.map((child) => ({
		task_id: child.task_id,
		state: child.state,
		blocked_by: child.blocked_by,
		scope_hint: scopeOfChild(input.root, input.children.find((c) => c.task_id === child.task_id) ?? { task_id: child.task_id, intent_path: null }),
	}));
}

const TERMINAL_NEXT_ACTIONS: Record<string, string> = {
	completed: "The batch integrated every enrollable child; review the commits and the tracker.",
	budget_stopped: "The child budget stopped new enrollments; re-confirm to continue under a new authorization.",
	failed: "A lineage failure stopped the batch; inspect the failing child and the branch state.",
	rejected: "The batch was rejected before any enrollment; correct the stated reason and re-confirm.",
	needs_human:
		"A parked child needs a human decision; its Lane is kept. Resolve it by hand, then re-confirm to continue.",
	running: "The batch is still running; no terminal report is due yet.",
	prepared: "The batch is prepared but not started.",
};

function laneReport(
	record: BatchLaneRunStateRecord,
	reason: string | null,
	nextAction: string,
	extra: { handoffs?: BatchLaneHandoff[]; refusals?: BatchLaneRunReport["lane_refusals"] } = {},
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
		next_action: nextAction || (TERMINAL_NEXT_ACTIONS[record.batch_state] ?? "Inspect the batch run state."),
		created_at: record.updated_at,
	};
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

/** Slots held by integrated and in-flight children are re-consumed on a fresh capability. */
function rehydrateConsumption(input: StartBatchInput, record: BatchLaneRunStateRecord): void {
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
		if (child.state === "pending" || child.state === "skipped_blocked" || child.state === "lane_admitted") continue;
		if (!input.registry.isChildConsumed(input.capability, child.task_id))
			input.registry.consumeChild(input.capability, binding, child.task_id);
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
		return refuse(input, persisted, PARALLEL_MISMATCH, "the recorded batch runs serially; max_parallel cannot be added on a resume");
	if (persisted && input.max_parallel !== undefined && input.max_parallel !== persisted.max_parallel)
		return refuse(input, persisted, PARALLEL_MISMATCH, `the recorded batch runs with max_parallel ${persisted.max_parallel}`);
	const limit = persisted?.max_parallel ?? input.max_parallel ?? 1;
	if (!input.children.length) return refuse(input, persisted, "batch_plan_empty", "batch plan is empty");

	const git = serialGitOf(input);
	const lanes = laneGitOf(input);

	let record: BatchLaneRunStateRecord;
	if (persisted) {
		record = persisted;
		assertPlanMatches(input, record);
		if (isTerminalBatchState(record.batch_state))
			return finalizeLane(input.root, record, `terminal state already reached: ${record.batch_state}`, "", {
				handoffs: record.batch_state === "completed" ? releaseHandoffs(input, record, lanes) : [],
			});
		if (record.batch_state === "needs_human")
			return finalizeLane(
				input.root,
				record,
				"a parked child needs a human decision",
				"A parked child keeps its Lane. Resolve it by hand, then re-confirm to continue.",
			);
	} else {
		const invalid = validateNewAuthorization(input);
		if (invalid) return refuse(input, null, "batch_authorization_invalid", invalid);
		const preflight = await git.preflight({
			root: input.root,
			initiative_slug: input.initiative_slug,
			base_head: input.base_head,
		});
		if (!preflight.ok) return refuse(input, null, preflight.reason, preflight.message || "Correct the preflight condition and re-confirm.");
		record = prepareBatchLaneRunState({
			batch_id: input.batch_id,
			initiative_slug: input.initiative_slug,
			children: input.children,
			plan_digest: input.plan_digest,
			base_head: input.base_head,
			confirmation_time: input.confirmation_time,
			budget: input.budget,
			max_parallel: limit,
			now: input.now,
		});
	}

	const persist = (): void => {
		record = writeBatchLaneRunState(input.root, record);
	};
	if (record.batch_state === "prepared") {
		record.batch_state = "running";
		persist();
	}

	// Adopt an integration the previous tick completed but did not record.
	for (const child of record.children) {
		if (child.state !== "lane_committed" || !child.lane?.lane_commit) continue;
		const found = lanes.findIntegrated({
			root: input.root,
			task_id: child.task_id,
			batch_id: record.batch_id,
			from_head: expectedBatchHead(record),
			lane_base: child.lane.base_head,
			lane_commit: child.lane.lane_commit,
		});
		if (!found) continue;
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
			await input.kernel.enrollTask({
				root: lane.path,
				task_id: taskId,
				batch: { registry: input.registry, capability: input.capability, binding: { batch_id: record.batch_id, expected_head: lane.base_head } },
			});
			record.children = record.children.map((c) => (c.task_id === taskId ? { ...c, state: "enrolled", reason: null } : c));
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

	// 1. Observe every in-flight Lane and drive each frozen child's QA and Review.
	// Nothing is inferred from terminal text; only Kernel facts move a child.
	for (const child of [...record.children]) {
		if ((child.state !== "lane_admitted" && child.state !== "enrolled") || !child.lane) continue;
		let fresh: Awaited<ReturnType<StartBatchInput["kernel"]["projectTask"]>>;
		try {
			fresh = await input.kernel.projectTask(child.lane.path, child.task_id);
		} catch {
			fresh = { error: "unreadable" } as unknown as typeof fresh;
		}
		if (fresh.error !== null) {
			parkChild(child.task_id, "batch_lane_lost");
			continue;
		}
		const holdsClaim = fresh.claim !== null && fresh.claim.task_id === child.task_id;
		if (child.state === "lane_admitted") {
			// A crash between admission and enrollment adopts an existing claim or enrolls now.
			if (holdsClaim) {
				record.children = record.children.map((c) =>
					c.task_id === child.task_id ? { ...c, state: "enrolled", reason: "adopted existing lane claim after interruption" } : c,
				);
				persist();
			} else {
				const failed = await enrollInLane(child.task_id);
				if (failed) return failed;
			}
			continue;
		}
		if (fresh.projection.lifecycle === "done" && fresh.projection.completion_ready) {
			record.children = record.children.map((c) => (c.task_id === child.task_id ? { ...c, state: "settled", reason: null } : c));
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
		// An unfrozen child, or one with QA pending the Executor's own attempt,
		// is the Executor's to move; the batch never reruns that attempt.
		if (fresh.projection.next_obligation === "run_qa" || fresh.projection.artifact_state !== "frozen") continue;
		const terminal = await input.kernel.advanceTask(child.lane.path, child.task_id);
		if (terminal.state === "completed") {
			record.children = record.children.map((c) =>
				c.task_id === child.task_id ? { ...c, state: "settled", reason: null, qa_failures: 0 } : c,
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
				record.children = record.children.map((c) =>
					c.task_id === child.task_id ? { ...c, state: "needs_human", reason, qa_failures: failures } : c,
				);
				skipDependents(record, child.task_id, `dependency ${child.task_id} parked`);
				parkedMessage ??= reason;
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

	// 2. Commit each settled child on its lane branch, then integrate it.
	for (const child of [...record.children]) {
		if (child.state !== "settled" || !child.lane) continue;
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
	for (const child of [...record.children]) {
		if (child.state !== "lane_committed" || !child.lane?.lane_commit) continue;
		const intentPathOf = (taskId: string) => input.children.find((c) => c.task_id === taskId)?.intent_path ?? null;
		try {
			const { commit } = await lanes.integrate({
				root: input.root,
				branch: record.branch ?? "",
				batch_head: expectedBatchHead(record),
				lane_base: child.lane.base_head,
				lane_commit: child.lane.lane_commit,
				child: { task_id: child.task_id, intent_path: intentPathOf(child.task_id) },
				siblings: record.children
					.filter((c) => c.state === "integrated" && c.task_id !== child.task_id)
					.map((c) => ({ task_id: c.task_id, intent_path: intentPathOf(c.task_id), commit: c.commit })),
			});
			record.children = record.children.map((c) => (c.task_id === child.task_id ? { ...c, state: "integrated", commit, reason: null } : c));
			record.commits = [...record.commits, commit];
			persist();
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			const reason = error instanceof BatchIntegrationError ? error.reason : "batch_integration_conflict";
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

	// 3. Admit offered Lanes, then enroll each admitted child into its Lane.
	const coordinatorReal = lanes.resolveRoot(input.root);
	for (const offer of input.lane_offers ?? []) {
		const startable = new Set(startableChildren(scheduleView(input, record), limit));
		const child = record.children.find((c) => c.task_id === offer.task_id);
		if (!child || child.state !== "pending" || !startable.has(child.task_id)) {
			refusals.push({ ...offer, reason: "batch_lane_unknown_child" });
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
		record.children = record.children.map((c) => (c.task_id === child.task_id ? { ...c, state: "lane_admitted", lane } : c));
		persist();
		const failed = await enrollInLane(child.task_id);
		if (failed) return failed;
	}

	// 4. Schedule and report. Handoffs are observations, never readiness.
	if (record.children.every((c) => c.state === "integrated" || c.state === "released")) {
		record.batch_state = "completed";
		persist();
		return finalizeLane(input.root, record, "all enrollable children integrated", "", {
			handoffs: releaseHandoffs(input, record, lanes),
			refusals,
		});
	}
	const handoffs: BatchLaneHandoff[] = [];
	for (const child of record.children) {
		if (child.state !== "enrolled" || !child.lane) continue;
		const fresh = await input.kernel.projectTask(child.lane.path, child.task_id);
		if (fresh.error !== null) continue;
		handoffs.push({
			role: "executor",
			task_id: child.task_id,
			run_id: fresh.projection.run_id ?? null,
			record_revision: fresh.projection.record_revision,
			next_obligation: fresh.projection.next_obligation,
			lane_branch: child.lane.branch,
		});
	}
	handoffs.push(...releaseHandoffs(input, record, lanes));
	const inFlight = record.children.filter((c) => IN_FLIGHT.has(c.state));
	const startable = startableChildren(scheduleView(input, record), limit);
	const overBudget = consumedSlots(record) >= record.budget.max_children;
	if (!inFlight.length && (!startable.length || overBudget)) {
		const parked = record.children.some((c) => c.state === "needs_human" || c.state === "skipped_blocked");
		record.batch_state = parked ? "needs_human" : overBudget ? "budget_stopped" : "needs_human";
		persist();
		return finalizeLane(
			input.root,
			record,
			parkedMessage ?? (parked ? "a parked child needs a human decision" : overBudget ? `max_children budget exhausted (${record.budget.max_children})` : "no child can start"),
			"",
			{ refusals },
		);
	}
	if (!overBudget) {
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
			{ handoffs, refusals },
		);
	}
	return laneReport(
		record,
		null,
		handoffs.some((h) => h.role === "lane-steward")
			? "Provide a Lane for each provision handoff, then call start_unattended_batch again with lane_offers."
			: "Run each executor handoff in its Lane. When a Lane finishes, call start_unattended_batch again with the same Initiative.",
		{ handoffs, refusals },
	);
}
