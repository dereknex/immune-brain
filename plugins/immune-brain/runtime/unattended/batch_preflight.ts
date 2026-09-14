// Host-independent batch preflight. Both Host adapters used to carry this
// projection verbatim (claim ownership, branch availability, working-tree
// cleanliness against the authorized scope, recovery children, plan digest, and
// base HEAD). It now lives here, below the Host boundary: no confirmation, no
// capability, no Host SDK, and no Host-identity branch. A Host adapter keeps
// only its confirmation transport, its failure-envelope shape, and its
// non-interactive refusal form.
//
// Every read is lock-free. Mutating Kernel entrypoints run pending-transaction
// recovery, and a preflight must write nothing before the literal user approves
// anything, including on decline, cancel, or rejection.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import { readBackendClaim } from "../kernel/backend_claim";
import { computeBatchPlanDigest } from "../kernel/batch_authority";
import { readGitHead } from "../kernel/pi_canary_prepare";
import { readTaskIntent } from "../kernel/intent";
import { readAuditTaskPair, readTaskRecordRaw, readWorkspaceStateRaw } from "../kernel/storage";
import { pathMatchesScope } from "../workspace_scope";
import { projectBatchPlan } from "./batch_plan";
import { batchReason, type BatchReasonKey } from "./batch_reasons";
import { isTerminalBatchState, type BatchRunStateRecord } from "./batch_state";
import type {
	BatchPlanBudget,
	BatchPlanChild,
	BatchPlanChildReason,
	InitiativeObservationReader,
} from "./types";

const INITIATIVE_SLUG_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const DEFAULT_BATCH_BUDGET_MS = 8 * 60 * 60 * 1_000;

export interface BatchPreflightOptions {
	root: string;
	initiative_slug: string;
	now?: string;
	readInitiative?: InitiativeObservationReader;
}

export interface BatchPreflightProjection {
	initiative_slug: string;
	batch_branch: string;
	is_resuming: boolean;
	existing_batch: BatchRunStateRecord | null;
	base_head: string;
	budget: BatchPlanBudget;
	plan_digest: string;
	recovery_children: BatchPlanChild[];
	/** Risk per child, captured by the authoritative read each Host renders. */
	risk_by_task: Record<string, string>;
	/** Children the plan excluded, in plan order. Empty on a resume. */
	excluded: Array<{ task_id: string; slice_id: string; reason: string }>;
}

export type BatchPreflightOutcome =
	| { ok: true; projection: BatchPreflightProjection }
	| { ok: false; state: "blocked" | "rejected"; reason: string; recovery_action: string };

export interface BatchPreflightRejection {
	state: "blocked" | "rejected";
	reason: string;
	recovery_action: string;
}

function reject(
	key: BatchReasonKey,
	detail = "",
): { ok: false } & BatchPreflightRejection {
	const resolved = batchReason(key, detail);
	return {
		ok: false,
		state: resolved.state === "blocked" ? "blocked" : "rejected",
		reason: resolved.reason,
		recovery_action: resolved.recovery_action,
	};
}

/**
 * The live claim's task id, or null: the workspace owner first, then an active
 * backend claim. Read-only and lock-free, so a preflight or a drift check can
 * call it before any literal-user approval without writing anything.
 */
export function readActiveClaimTaskId(root: string): string | null {
	const workspace = readWorkspaceStateRaw(root);
	const claim = readBackendClaim(root);
	return workspace.state.current_working || (claim?.lifecycle_status === "active" ? claim.task_id : null);
}

/**
 * The batch record for this initiative, or a corruption marker. A terminal
 * record (completed, budget_stopped, failed, rejected) is not active: returning
 * it would let a settled batch block or be resumed by a later run.
 */
export type BatchRecordLookup =
	| { corrupt: true; path: string }
	| { corrupt: false; record: BatchRunStateRecord }
	| null;

export function findExistingActiveBatch(root: string, initiativeSlug: string): BatchRecordLookup {
	const batchesDir = join(root, ".imm", "state", "batches");
	if (!existsSync(batchesDir)) return null;
	for (const file of readdirSync(batchesDir)) {
		if (!file.endsWith(".json")) continue;
		let record: unknown;
		try {
			record = JSON.parse(readFileSync(join(batchesDir, file), "utf8"));
		} catch {
			// Unreadable Kernel batch state must fail closed: silently treating the
			// initiative as batchless could authorize a parallel run.
			return { corrupt: true, path: file };
		}
		const candidate = record as BatchRunStateRecord;
		if (candidate?.contract !== "assurance_kernel/batch_run_state/v1") continue;
		if (candidate.initiative_slug !== initiativeSlug) continue;
		const validStates = new Set([
			"prepared",
			"running",
			"needs_human",
			"completed",
			"budget_stopped",
			"failed",
			"rejected",
		]);
		if (
			typeof candidate.batch_id !== "string" ||
			typeof candidate.base_head !== "string" ||
			!Array.isArray(candidate.children) ||
			!validStates.has(candidate.batch_state)
		) {
			return { corrupt: true, path: file };
		}
		if (isTerminalBatchState(candidate.batch_state)) continue;
		return { corrupt: false, record: candidate };
	}
	return null;
}

/**
 * The newest *settled* record for this initiative, or null. A terminal record is
 * not a batch to resume, but a later call still replays its terminal report
 * instead of starting a parallel run: the runner replays when it is handed the
 * settled record's identity, and the batch branch it created is not a conflict.
 */
export function findSettledBatchRecord(root: string, initiativeSlug: string): BatchRunStateRecord | null {
	const batchesDir = join(root, ".imm", "state", "batches");
	if (!existsSync(batchesDir)) return null;
	let newest: BatchRunStateRecord | null = null;
	for (const file of readdirSync(batchesDir).sort()) {
		if (!file.endsWith(".json")) continue;
		let record: unknown;
		try {
			record = JSON.parse(readFileSync(join(batchesDir, file), "utf8"));
		} catch {
			// The active lookup already fails closed on an unreadable record.
			continue;
		}
		const candidate = record as BatchRunStateRecord;
		if (candidate?.contract !== "assurance_kernel/batch_run_state/v1") continue;
		if (candidate.initiative_slug !== initiativeSlug) continue;
		if (!isTerminalBatchState(candidate.batch_state)) continue;
		if (typeof candidate.batch_id !== "string" || typeof candidate.base_head !== "string") continue;
		if (!Array.isArray(candidate.children)) continue;
		if (!newest || Date.parse(candidate.updated_at) >= Date.parse(newest.updated_at)) newest = candidate;
	}
	return newest;
}

/** The HEAD a resumable batch must still sit on: its last child commit, or its base. */
export function expectedBatchHead(record: { base_head: string; commits?: unknown }): string {
	const commits = Array.isArray(record.commits) ? (record.commits as string[]) : [];
	return commits.length > 0 ? commits[commits.length - 1]! : record.base_head;
}

/**
 * Whether the live claim is this batch's own interrupted child: same task, on
 * the batch branch, still a live child of the record, with a claim minted by
 * that child's enrollment and bound to its TaskRecord.
 */
export function isOwnBatchClaim(
	root: string,
	existingBatch: BatchRunStateRecord,
	taskId: string,
	batchBranch: string,
): boolean {
	let claim: Record<string, any> | null = null;
	let workspace: Record<string, any> | null = null;
	try {
		claim = JSON.parse(readFileSync(join(root, ".imm", "state", "active-claim.json"), "utf8"));
		workspace = JSON.parse(readFileSync(join(root, ".imm", "state", "workspace.json"), "utf8"));
	} catch {
		return false;
	}
	const currentTaskId =
		workspace?.state?.current_working ||
		(claim?.lifecycle_status === "active" ? claim?.task_id : null);
	if (currentTaskId !== taskId || !claim) return false;
	const branch = spawnSync("git", ["-C", root, "branch", "--show-current"], { encoding: "utf8" }).stdout.trim();
	if (branch !== batchBranch) return false;
	const childInBatch = existingBatch.children.find((c) => c.task_id === taskId);
	if (!childInBatch || !(childInBatch.state === "enrolled" || childInBatch.state === "needs_human")) {
		return false;
	}
	let rec: Record<string, any> | null = null;
	try {
		rec = JSON.parse(readFileSync(join(root, ".imm", "state", "tasks", `${taskId}.json`), "utf8"));
	} catch {
		return false;
	}
	if (!rec) return false;
	const lineageHeads = [existingBatch.base_head].concat(
		Array.isArray(existingBatch.commits) ? existingBatch.commits : [],
	);
	if (!lineageHeads.includes(rec.git_base_head)) return false;
	if (claim.enrollment_event_id !== `enroll-${taskId}-${claim.created_at}`) return false;
	const createdAt = Date.parse(claim.created_at);
	if (!Number.isFinite(createdAt) || createdAt > Date.parse(existingBatch.updated_at)) return false;
	if (claim.task_id !== taskId || claim.lifecycle_status !== "active") return false;
	if (claim.intent_revision !== rec.intent_snapshot?.revision) return false;
	if (claim.intent_content_hash !== rec.intent_ref?.content_hash) return false;
	return true;
}

/**
 * The in-flight child's authorized scope, read lock-free: the Kernel TaskRecord
 * snapshot first (a frozen sidecar is archived and must not shrink the scope to
 * empty), then the immutable terminal audit pair for a settled child, then the
 * sidecar the record's own `intent_ref` path names.
 */
function authorizedScopeOf(root: string, taskId: string, state: string): string[] {
	let scope: string[] = [];
	let recordedIntentPath: string | undefined;
	try {
		const recordRead = readTaskRecordRaw(root, taskId);
		scope = recordRead.record?.intent_snapshot?.scope_hint ?? [];
		recordedIntentPath = recordRead.record?.intent_ref?.path;
	} catch {
		// fallback below
	}
	if (scope.length === 0 && state === "settled") {
		// A settled child has no live state record; its authority is the immutable
		// terminal audit pair. Read-only, so a refusal still writes nothing.
		try {
			const settled = readAuditTaskPair(root, taskId);
			const snapshot = (settled?.record as { intent_snapshot?: { scope_hint?: string[] } } | null | undefined)
				?.intent_snapshot;
			scope = snapshot?.scope_hint ?? [];
			recordedIntentPath = recordedIntentPath ?? (settled?.record as { intent_ref?: { path?: string } } | null | undefined)
				?.intent_ref?.path;
		} catch {
			// fallback below
		}
	}
	if (scope.length === 0) {
		try {
			scope = readTaskIntent(root, taskId, recordedIntentPath).intent.scope_hint ?? [];
		} catch {
			// fallback below
		}
	}
	return scope;
}

function porcelainEntries(root: string): Array<{ code: string; path: string }> | null {
	// review-batch-resume-porcelain-leading-space: parse the NUL-delimited v1
	// format. Trimming the whole output first shifted the fixed status columns of
	// an unstaged modification (" M path") and silently mis-scoped the path.
	const statusProc = spawnSync(
		"git",
		["-C", root, "status", "--porcelain=v1", "-z", "--no-renames", "--untracked-files=all"],
		{ encoding: "utf8" },
	);
	if (statusProc.status !== 0) return null;
	const entries: Array<{ code: string; path: string }> = [];
	// -z with --no-renames lists each side of a rename as its own D/A entry, so a
	// cross-scope rename cannot hide the out-of-scope source deletion.
	for (const entry of statusProc.stdout.split("\0")) {
		if (entry.length === 0) continue;
		entries.push({ code: entry.slice(0, 2), path: entry.slice(3) });
	}
	return entries;
}

/**
 * The preflight projection, or the first rejection it hits. Purely read-only:
 * it performs no confirmation, mints no capability, and branches on no Host.
 */
interface PlanSurface {
	budget: BatchPlanBudget;
	plan_digest: string;
	recovery_children: BatchPlanChild[];
	risk_by_task: Record<string, string>;
	excluded: Array<{ task_id: string; slice_id: string; reason: string }>;
}

type PlanSurfaceOutcome =
	| { ok: true; surface: PlanSurface }
	| { ok: false; key: BatchReasonKey; detail: string };

/**
 * The plan half of the projection: the confirmed plan surface for a fresh run,
 * or the record's reconstructed children for a resume. Shared by the preflight
 * and the post-confirmation drift check so both read one implementation.
 */
async function projectPlanSurface(input: {
	root: string;
	initiative_slug: string;
	is_resuming: boolean;
	existing_batch: BatchRunStateRecord | null;
	now: string;
	readInitiative?: InitiativeObservationReader;
}): Promise<PlanSurfaceOutcome> {
	const { root, initiative_slug: initiativeSlug, is_resuming: isResuming, existing_batch: existingBatch, now } = input;
	let recoveryChildren: BatchPlanChild[] = [];
	let planDigest: string;
	let excluded: Array<{ task_id: string; slice_id: string; reason: string }> = [];
	const riskByTask = new Map<string, string>();
	// A settled record is not a resume: it keeps its identity and branch, and
	// still replays from its own children below instead of a fresh plan
	// projection, but a fresh run over it must issue the fresh default budget
	// rather than inherit a deadline that has already passed.
	let budget: BatchPlanBudget = isResuming && existingBatch
		? existingBatch.budget
		: { max_children: 10, deadline_at: new Date(Date.now() + DEFAULT_BATCH_BUDGET_MS).toISOString(), qa_failure_limit: 2 };

	if (existingBatch) {
		try {
			recoveryChildren = existingBatch!.children.map((c) => {
				const intentPath = `docs/plans/${c.task_id}.intent.json`;
				let read: { intent: { revision: number; risk: string }; content_hash: string } = {
					intent: { revision: 1, risk: "material" },
					content_hash: "",
				};
				try {
					const taskRecordRead = readTaskRecordRaw(root, c.task_id);
					if (taskRecordRead.record) {
						read = {
							intent: taskRecordRead.record.intent_snapshot as { revision: number; risk: string },
							content_hash: taskRecordRead.record.intent_ref.content_hash,
						};
					} else {
						read = readTaskIntent(root, c.task_id, intentPath) as unknown as typeof read;
					}
				} catch {
					const archivePath = `docs/plans/archive/${c.task_id}.intent.json`;
					try {
						read = readTaskIntent(root, c.task_id, archivePath) as unknown as typeof read;
					} catch {
						read = readTaskIntent(root, c.task_id, intentPath) as unknown as typeof read;
					}
				}
				// Keep the risk captured by the authoritative read above; a stale
				// reconstructed path must never fabricate a risk later.
				riskByTask.set(c.task_id, read.intent?.risk ?? "material");
				const isDone = c.state === "committed" || c.state === "settled";
				return {
					task_id: c.task_id,
					slice_id: c.slice_id,
					status: isDone ? ("already_settled" as const) : ("enrollable" as const),
					blocked_by: [...c.blocked_by],
					// Persisted reasons come from the same closed vocabulary the plan wrote.
					reason: (c.reason ?? null) as BatchPlanChildReason | null,
					intent_path: intentPath,
					intent_revision: read.intent.revision,
					intent_content_hash: read.content_hash,
				} satisfies BatchPlanChild;
			});
		} catch (err) {
			return { ok: false, key: "plan_projection_failed", detail: err instanceof Error ? err.message : String(err) };
		}
		planDigest = computeBatchPlanDigest(
			recoveryChildren.map((c) => ({
				task_id: c.task_id,
				intent_path: c.intent_path ?? `docs/plans/${c.task_id}.intent.json`,
				intent_revision: c.intent_revision ?? 1,
				intent_content_hash: c.intent_content_hash ?? "",
				blocked_by: c.blocked_by,
			})),
		);
	} else {
		let plan;
		try {
			plan = await projectBatchPlan(root, initiativeSlug, { confirmation_time: now }, input.readInitiative);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			if (msg.includes("has no enrollable children"))
				return { ok: false, key: "empty_enrollable_set", detail: "" };
			return { ok: false, key: "plan_projection_failed", detail: msg };
		}
		if (!plan.enrollable.length)
			return { ok: false, key: "empty_enrollable_set", detail: "" };

		budget = plan.budget;
		const enrollableChildById = new Map(plan.enrollable.map((c) => [c.task_id, c]));
		recoveryChildren = plan.children
			.filter((c) => c.status === "enrollable")
			.map((c) => {
				const digestChild = enrollableChildById.get(c.task_id);
				return {
					...c,
					blocked_by: digestChild ? [...digestChild.blocked_by] : c.blocked_by,
				} satisfies BatchPlanChild;
			});
		planDigest = computeBatchPlanDigest(plan.enrollable);

		for (const c of plan.children.filter((item) => item.status === "enrollable")) {
			let childRisk = "material";
			try {
				childRisk = readTaskIntent(root, c.task_id, c.intent_path ?? undefined).intent.risk;
			} catch {
				// fallback
			}
			riskByTask.set(c.task_id, childRisk);
		}
		excluded = plan.children
			.filter((c) => c.status !== "enrollable")
			.map((c) => ({ task_id: c.task_id, slice_id: c.slice_id, reason: c.reason ?? c.status }));
	}

	return {
		ok: true,
		surface: {
			budget,
			plan_digest: planDigest,
			recovery_children: recoveryChildren,
			risk_by_task: Object.fromEntries(
				[...riskByTask.entries()].sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0)),
			),
			excluded,
		},
	};
}

export async function projectBatchPreflight(
	options: BatchPreflightOptions,
): Promise<BatchPreflightOutcome> {
	const { root, initiative_slug: initiativeSlug, readInitiative } = options;
	if (!INITIATIVE_SLUG_PATTERN.test(initiativeSlug))
		return reject("invalid_slug", initiativeSlug);

	// Existing active/paused batch for this initiative: a terminal record is not active.
	const found = findExistingActiveBatch(root, initiativeSlug);
	if (found?.corrupt)
		return reject("batch_state_unreadable", found.path);
	// A settled record is not a resume, but it still owns the batch branch and
	// identity a later call replays instead of starting a parallel run.
	const activeRecord: BatchRunStateRecord | null = found ? found.record : null;
	const existingBatch: BatchRunStateRecord | null = activeRecord ?? findSettledBatchRecord(root, initiativeSlug);
	const isResuming = activeRecord !== null;
	const batchBranch = `imm/${initiativeSlug}`;

	// 1. Active workspace claim (pre-confirmation).
	const activeTaskId = readActiveClaimTaskId(root);
	const ownClaim =
		isResuming && activeTaskId !== null && isOwnBatchClaim(root, activeRecord!, activeTaskId, batchBranch);
	if (activeTaskId && !ownClaim)
		return reject("claim_already_active", activeTaskId);

	// 2. HEAD, branch availability, working tree (pre-confirmation, read-only).
	let baseHead: string;
	try {
		baseHead = readGitHead(root);
	} catch (err) {
		return reject("git_head_unreadable", err instanceof Error ? err.message : String(err));
	}
	const branchExists = spawnSync("git", ["-C", root, "show-ref", "--verify", "--quiet", `refs/heads/${batchBranch}`]);
	if (branchExists.status === 0 && !existingBatch)
		return reject("branch_already_exists", batchBranch);

	const statusEntries = porcelainEntries(root);
	if (statusEntries === null)
		return reject("git_status_unreadable");
	if (statusEntries.length > 0) {
		if (!isResuming)
			return reject("working_tree_dirty");
		// Kernel projections accept staged in-flight work inside the active child's
		// authorized scope, and reject unstaged/untracked bytes or out-of-scope paths.
		// `settled` belongs here: Kernel settlement happens before the batch commits
		// the child, and settlement clears the live state record, so a crash in that
		// window resumes into a settled child whose staged work is legitimate.
		const inFlightChild = existingBatch!.children.find(
			(c) => c.state === "enrolled" || c.state === "needs_human" || c.state === "settled",
		);
		let authorizedScope: string[] = [];
		if (inFlightChild) {
			authorizedScope = authorizedScopeOf(root, inFlightChild.task_id, inFlightChild.state);
			if (authorizedScope.length === 0)
				return reject("authorized_scope_underivable");
		}
		const dirtyBytes = statusEntries.some(({ code }) => code === "??" || code[1] !== " ");
		if (dirtyBytes)
			return reject("working_tree_unstaged");
		let outsideScope = false;
		for (const { path } of statusEntries) {
			if (path.startsWith(".imm/") || path.startsWith("docs/plans/") || path.startsWith("docs/specs/")) continue;
			// Scope entries may be exact files, directories, or globs; delegate the
			// boundary matching to the Kernel's own helper instead of exact includes.
			let matched = false;
			for (const scopePath of authorizedScope) {
				if (pathMatchesScope(path, scopePath)) {
					matched = true;
					break;
				}
			}
			if (!matched) {
				outsideScope = true;
				break;
			}
		}
		if (outsideScope)
			return reject("working_tree_out_of_scope");
	}

	// 3. Project or reconstruct the plan (pre-confirmation).
	const now = options.now ?? new Date().toISOString();
	const planSurface = await projectPlanSurface({
		root,
		initiative_slug: initiativeSlug,
		is_resuming: isResuming,
		existing_batch: existingBatch,
		now,
		readInitiative,
	});
	if (!planSurface.ok)
		return reject(planSurface.key, planSurface.detail);

	return {
		ok: true,
		projection: {
			initiative_slug: initiativeSlug,
			batch_branch: batchBranch,
			is_resuming: isResuming,
			existing_batch: existingBatch,
			base_head: baseHead,
			budget: planSurface.surface.budget,
			plan_digest: planSurface.surface.plan_digest,
			recovery_children: planSurface.surface.recovery_children,
			risk_by_task: planSurface.surface.risk_by_task,
			excluded: planSurface.surface.excluded,
		},
	};
}

/**
 * The drift surface a Host re-checks after the literal user confirmed, using
 * the same implementations as the preflight: the live claim, the batch plan
 * digest, and the base HEAD. `plan_digest === null` means the plan could not be
 * read at all, which a Host reports as unreadable rather than changed.
 */
export interface BatchDriftProjection {
	active_claim_task_id: string | null;
	own_claim: boolean;
	base_head: string | null;
	plan_digest: string | null;
	plan_unavailable_reason: string | null;
}

export async function projectBatchDrift(options: BatchPreflightOptions): Promise<BatchDriftProjection> {
	const { root, initiative_slug: initiativeSlug, readInitiative } = options;
	const found = findExistingActiveBatch(root, initiativeSlug);
	const activeRecord: BatchRunStateRecord | null = found && !found.corrupt ? found.record : null;
	const existingBatch: BatchRunStateRecord | null = activeRecord ?? findSettledBatchRecord(root, initiativeSlug);
	const isResuming = activeRecord !== null;
	const batchBranch = `imm/${initiativeSlug}`;
	const activeClaimTaskId = readActiveClaimTaskId(root);
	const surface = await projectPlanSurface({
		root,
		initiative_slug: initiativeSlug,
		is_resuming: isResuming,
		existing_batch: existingBatch,
		now: options.now ?? new Date().toISOString(),
		readInitiative,
	});
	// HEAD is read AFTER the plan surface: the whole point of the drift check is
	// to catch a commit that landed during the asynchronous plan read.
	let baseHead: string | null = null;
	try {
		baseHead = readGitHead(root);
	} catch {
		// The Host reports an unreadable repository from the null it sees here.
	}
	return {
		active_claim_task_id: activeClaimTaskId,
		own_claim:
			isResuming && activeClaimTaskId !== null && isOwnBatchClaim(root, existingBatch!, activeClaimTaskId, batchBranch),
		base_head: baseHead,
		plan_digest: surface.ok ? surface.surface.plan_digest : null,
		plan_unavailable_reason: surface.ok ? null : batchReason(surface.key, surface.detail).reason,
	};
}
