// Serial batch run driver for unattended Initiative batch runs.
// Every batch and child state transition lives here and in
// runtime/kernel/batch_authority.ts; Host adapters are callers only and this
// module imports no Host adapter (Invariant H-1).
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
	BatchAuthorizationExpiryError,
	type BatchAuthorityRegistry,
	type ValidatedBatchAuthorization,
	computeBatchPlanDigest,
} from "../kernel/batch_authority";
import type { AssuranceProjectionResult } from "../kernel/assurance_projection";
import type { BatchPlanChild } from "./types";
import {
	type BatchRunnerGitPort,
	type BatchGitPreflightResult,
	runBatchGitPreflight,
	commitBatchChild,
	lookupBatchCommit,
} from "./batch_git";
import {
	type BatchRunStateRecord,
	type BatchChildRun,
	type BatchRunReport,
	isTerminalBatchState,
	prepareBatchRunState,
	readBatchRunState,
	writeBatchRunState,
	writeBatchRunReport,
} from "./batch_state";

/** Kernel-facing ports the driver needs. Host adapters supply these. */
export interface BatchRunnerKernelPort {
	/** Enroll one child through the batch-derived capability. */
	enrollTask(input: {
		root: string;
		task_id: string;
		batch: {
			registry: BatchAuthorityRegistry;
			capability: object;
			binding: { batch_id: string; expected_head: string };
		};
	}): Promise<{ record_revision: string }>;
	/** Drive one enrolled child toward its own Kernel terminal settlement. */
	advanceTask(root: string, taskId: string): Promise<BatchChildAdvanceResult>;
	/** Scope-bound commit after Kernel reports a child done. */
	commitChild?(
		root: string,
		taskId: string,
		batchId: string,
		head: string,
		branch?: string,
		intentPath?: string,
	): Promise<{ commit: string }>;
	/** review-3(5th round): read the already-created batch commit for a child,
	 * or null when none exists. Lets crash recovery adopt an existing commit
	 * instead of replaying the commitChild mutation. */
	lookupBatchCommit?(
		root: string,
		taskId: string,
		batchId: string,
		expectedHead?: string,
		branch?: string,
	): Promise<{ commit: string } | null>;
	/** Optional Git preflight check. */
	gitPreflight?(input: {
		root: string;
		initiative_slug: string;
		base_head: string;
	}): Promise<BatchGitPreflightResult> | BatchGitPreflightResult;
	/** review-2(5th round): read-only claim projection for enrollment
	 * reconciliation after an interruption between enrollTask and its state
	 * persistence. Uses the real AssuranceProjectionResult contract; batch
	 * ownership of the claim is verified separately through the authoritative
	 * batch registry, because the Kernel claim carries no batch id. */
	projectTask(root: string, taskId: string): Promise<AssuranceProjectionResult>;
	/** Authoritative batch ownership check: true when the task's Kernel claim
	 * is held under this batch's derived capability (consumed child slot). */
	ownsTaskClaim(taskId: string): boolean;
	/** review-8(4th rework): Kernel-side proof that a replacement parked-batch
	 * authorization is genuine, unexpired, and bound to this exact batch_id,
	 * plan_digest, and base_head, validated against the Kernel's authoritative
	 * binding state. Throws on fabrication, mismatch, or expiry; the driver
	 * must call this before accepting a parked-batch resume. */
	validateBatchAuthorization(input: {
		registry: BatchAuthorityRegistry;
		capability: object;
		binding: Pick<ValidatedBatchAuthorization,
			"batch_id" | "plan_digest" | "base_head" | "initiative_slug" | "budget" | "expires_at">;
	}): ValidatedBatchAuthorization;
}

export type BatchChildAdvanceResult =
	| { state: "completed" }
	| { state: "stopped" }
	| { state: "failed"; reason: string }
	| { state: "rework"; operation: "qa" | "review"; summary: string }
	| { state: "blocked"; reason: string }
	| { state: "review_ready"; operation_id: string };

export interface StartBatchInput {
	root: string;
	batch_id: string;
	initiative_slug: string;
	registry: BatchAuthorityRegistry;
	capability: object;
	children: BatchPlanChild[];
	plan_digest: string;
	base_head: string;
	confirmation_time: string;
	authorization_expires_at: string;
	budget: { max_children: number; deadline_at: string; qa_failure_limit: number };
	now: string;
	kernel: BatchRunnerKernelPort;
	git?: BatchRunnerGitPort;
}

export type { BatchRunReport } from "./batch_state";

function dependentsOf(record: BatchRunStateRecord, taskId: string): BatchChildRun[] {
	return record.children.filter((child) => child.blocked_by.includes(taskId));
}

function skipDependents(record: BatchRunStateRecord, taskId: string, reason: string): void {
	// review-1(5th round): traverse the full transitive dependency closure —
	// parking A must skip B *and* C in A -> B -> C, not only direct dependents.
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
		skip.has(child.task_id) && child.state === "pending"
			? { ...child, state: "skipped_blocked", reason } : child,
	);
}

function budgetStopReason(record: BatchRunStateRecord, now: number): string | null {
	// review-3: budget counts enrollments consumed (children that left
	// pending), not commits, so parked children still consume authorization.
	const enrolledCount = record.children.filter(
		(child) => child.state !== "pending" && child.state !== "skipped_blocked",
	).length;
	if (enrolledCount >= record.budget.max_children)
		return `max_children budget exhausted (${record.budget.max_children})`;
	const deadline = Date.parse(record.budget.deadline_at);
	if (!Number.isNaN(deadline) && now >= deadline)
		return `deadline_at reached (${record.budget.deadline_at})`;
	return null;
}

/** review-7(3rd rework): the typed expiry marker now lives at the Kernel
 * boundary (kernel/batch_authority.ts) so a real enrollment-time expiry is
 * structurally classifiable as an intentional budget stop; re-exported here
 * for driver API compatibility. */
export { BatchAuthorizationExpiryError };

function isAuthorizationExpiryError(error: unknown): boolean {
	return error instanceof BatchAuthorizationExpiryError;
}

function requireFreshProjection(
	result: AssuranceProjectionResult,
	taskId: string,
): AssuranceProjectionResult & { error: null } {
	if (result.error !== null)
		throw new Error(`cannot reconcile Kernel projection for ${taskId}: ${result.error}`);
	return result as AssuranceProjectionResult & { error: null };
}

/** Next pending child whose direct dependents are all committed. */
function nextEnrollableChild(record: BatchRunStateRecord): BatchChildRun | null {
	return (
		record.children.find(
			(child) =>
				child.state === "pending" &&
				record.children.every(
					(other) => !child.blocked_by.includes(other.task_id) || other.state === "committed",
				),
		) ?? null
	);
}

const TERMINAL_NEXT_ACTIONS: Record<string, string> = {
	completed: "The batch settled every enrollable child; review the commits and the tracker.",
	budget_stopped: "Budget, deadline, or authorization expiry stopped new enrollments; re-confirm to continue under a new authorization.",
	failed: "A commit or lineage failure stopped the batch; inspect the failing child and the branch state.",
	rejected: "The batch was rejected before any enrollment; correct the stated reason and re-confirm.",
	needs_human: "A parked child needs a human decision; resolve it, then re-confirm to continue.",
	running: "The batch is still running; no terminal report is due yet.",
	prepared: "The batch is prepared but not started.",
};

function reportFor(
	record: BatchRunStateRecord,
	reason: string | null,
	nextAction: string,
): BatchRunReport {
	return {
		contract: "assurance_kernel/batch_run_report/v1",
		batch_id: record.batch_id,
		initiative_slug: record.initiative_slug,
		batch_state: record.batch_state,
		children: record.children,
		commits: record.commits,
		reason,
		next_action: nextAction || (TERMINAL_NEXT_ACTIONS[record.batch_state] ?? "Inspect the batch run state."),
		created_at: record.updated_at,
	};
}

/** review-3(6th round): persist the single run report when the batch
 * stops — including a needs_human park, which ends the current run even
 * though the batch remains resumable after a human decision. */
function finalize(
	root: string,
	record: BatchRunStateRecord,
	reason: string | null,
	nextAction: string,
): BatchRunReport {
	const report = reportFor(record, reason, nextAction);
	if (isTerminalBatchState(record.batch_state) || record.batch_state === "needs_human") {
		writeBatchRunReport(root, report);
	}
	return report;
}

/** review round 8: only lineage breaks (external branch switch / HEAD
 * regression) on a persisted record fail the batch with a persisted report;
 * fabricated records keep throwing with zero writes. */
function isLineageBreakError(message: string): boolean {
	return message.includes("batch_head_lineage_broken");
}

/** review round 9: a lineage-broken persisted batch may hold in-flight
 * children; failed batches reject enrolled/settled children, so transition
 * them to needs_human and skip their pending dependents before persisting. */
function failPersistedLineage(
	root: string,
	existing: BatchRunStateRecord,
	message: string,
): BatchRunStateRecord {
	const children = existing.children.map((c) =>
		c.state === "enrolled" || c.state === "settled"
			? { ...c, state: "needs_human" as const, reason: message }
			: c,
	);
	const record: BatchRunStateRecord = { ...existing, batch_state: "failed", children };
	for (const child of record.children) {
		if (child.state === "needs_human") {
			skipDependents(record, child.task_id, `dependency ${child.task_id} parked`);
		}
	}
	return writeBatchRunState(root, record);
}

/** review round 11: detect external HEAD movement or branch switch against a
 * persisted record's expected lineage; returns the failure message or null. */
function externalHeadDriftMessage(root: string, record: BatchRunStateRecord): string | null {
	if (!existsSync(join(root, ".git"))) return null;
	const head = record.commits.length
		? record.commits[record.commits.length - 1]!
		: record.base_head;
	const headCheck = spawnSync("git", ["-C", root, "rev-parse", "HEAD"], {
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	});
	if (headCheck.status === 0 && headCheck.stdout.trim() && headCheck.stdout.trim() !== head) {
		return `batch_head_lineage_broken: current HEAD ${headCheck.stdout.trim()} does not match expected batch head ${head}`;
	}
	const branchCheck = spawnSync("git", ["-C", root, "symbolic-ref", "--short", "HEAD"], {
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	});
	const currentBranch = branchCheck.stdout.trim();
	if (branchCheck.status !== 0 || currentBranch !== record.branch) {
		return `batch_head_lineage_broken: current branch ${currentBranch} does not match expected batch branch ${record.branch}`;
	}
	return null;
}

async function validatePersistedRun(input: StartBatchInput, record: BatchRunStateRecord): Promise<void> {
	const plan = input.registry.children(input.capability);
	if (record.plan_digest !== computeBatchPlanDigest(plan) ||
		record.children.length !== plan.length || record.children.some((child, index) => {
			const expected = plan[index]!;
			return child.task_id !== expected.task_id ||
				JSON.stringify(child.blocked_by) !== JSON.stringify(expected.blocked_by);
		})) throw new Error("plan_digest mismatch: persisted children do not match the authorized plan");
	const commits: string[] = [];
	for (const child of record.children) {
		if (child.state !== "committed") {
			if (child.commit !== null) throw new Error("uncommitted batch child has a commit");
			continue;
		}
		const evidence = input.git?.lookupBatchCommit
			? await input.git.lookupBatchCommit(input.root, child.task_id, record.batch_id, undefined, record.branch)
			: input.kernel.lookupBatchCommit
				? await input.kernel.lookupBatchCommit(input.root, child.task_id, record.batch_id, undefined, record.branch)
				: await lookupBatchCommit({
					root: input.root,
					taskId: child.task_id,
					batchId: record.batch_id,
					branch: record.branch,
				});
		if (!evidence || evidence.commit !== child.commit) {
			// Distinguish an unreachable recorded commit (external HEAD regression)
			// from a fabricated record: reachability is only checkable in a real repo.
			if (
				evidence === null && typeof child.commit === "string" && child.commit.length > 0 &&
				existsSync(join(input.root, ".git"))
			) {
				const reach = spawnSync(
					"git",
					["-C", input.root, "merge-base", "--is-ancestor", child.commit, "HEAD"],
					{ encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
				);
				if (reach.status !== 0) {
					throw new Error(
						`batch_head_lineage_broken: recorded commit ${child.commit} for ${child.task_id} is no longer reachable from HEAD`,
					);
				}
			}
			throw new Error(`persisted batch commit lacks evidence for ${child.task_id}`);
		}
		commits.push(evidence.commit);
	}
	if (JSON.stringify([...record.commits].sort()) !== JSON.stringify(commits.sort()))
		throw new Error("persisted batch commit list does not match child evidence");
}

/** review-6: restate a terminal record and ensure its report exists. */
function replayTerminal(
	root: string,
	existing: BatchRunStateRecord,
): BatchRunReport {
	return finalize(
		root,
		existing,
		`terminal state already reached: ${existing.batch_state}`,
		"",
	);
}

function validateRunAuthorization(input: StartBatchInput, existing: BatchRunStateRecord | null): void {
	const authorized = input.kernel.validateBatchAuthorization({
		registry: input.registry,
		capability: input.capability,
		binding: {
			batch_id: input.batch_id,
			plan_digest: existing?.plan_digest ?? input.plan_digest,
			base_head: existing?.base_head ?? input.base_head,
			initiative_slug: existing?.initiative_slug ?? input.initiative_slug,
			budget: input.budget,
			expires_at: input.authorization_expires_at,
		},
	});
	if (authorized.issued_at !== input.confirmation_time ||
		(existing && Date.parse(authorized.issued_at) <= Date.parse(existing.confirmation_time)))
		throw new Error("the parked batch requires a fresh literal-user confirmation");
	const children = input.children.map((child) => {
		const { intent_path, intent_revision, intent_content_hash } = child;
		if (intent_path === null || intent_revision === null || intent_content_hash === null)
			throw new Error(`batch child ${child.task_id} has no complete intent identity`);
		return { ...child, intent_path, intent_revision, intent_content_hash };
	});
	if (computeBatchPlanDigest(children) !== authorized.plan_digest ||
		input.plan_digest !== authorized.plan_digest || input.base_head !== authorized.base_head)
		throw new Error("batch run input does not match the authorized plan or base_head");
}

export async function startBatch(input: StartBatchInput): Promise<BatchRunReport> {
	// Validation failure before the first enrollment: zero writes, rejected.
	// reportFor only builds the report object; finalize would persist it and
	// the spec forbids any write on a pre-enrollment rejection.
	if (!input.children.length) {
		const rejected = prepareBatchRunState({ ...input, children: [], now: input.now });
		return reportFor(
			{ ...rejected, batch_state: "rejected" },
			"batch plan is empty",
			"Provide a non-empty enrollable child plan.",
		);
	}

	let existing = readBatchRunState(input.root, input.batch_id);
	if (existing) {
		try {
			await validatePersistedRun(input, existing);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			if (isLineageBreakError(message)) {
				if (isTerminalBatchState(existing.batch_state)) return replayTerminal(input.root, existing);
				const failed = failPersistedLineage(input.root, existing, message);
				return finalize(input.root, failed, message, "");
			}
			throw error;
		}
	}
	if (existing && isTerminalBatchState(existing.batch_state)) {
		// Idempotent terminal replay: no state mutation, ensure the report.
		return replayTerminal(input.root, existing);
	}

	if (existing?.batch_state === "needs_human") {
		const priorConfirmation = Date.parse(existing.confirmation_time);
		const nextConfirmation = Date.parse(input.confirmation_time);
		const nextExpiry = Date.parse(input.authorization_expires_at);
		const freshAuthorization =
			Number.isFinite(nextConfirmation) &&
			nextConfirmation > priorConfirmation &&
			Number.isFinite(nextExpiry) &&
			nextExpiry > Date.now();
		if (!freshAuthorization) {
			return finalize(
				input.root,
				existing,
				"the parked batch requires a fresh literal-user confirmation",
				"Resolve the parked child, then re-confirm the batch to continue.",
			);
		}

		validateRunAuthorization(input, existing);
		prepareBatchRunState({ ...input, now: input.now });
		const remapped = await Promise.all(
			existing.children.map(async (child) => {
				if (child.state !== "needs_human") return child;
				const fresh = requireFreshProjection(
					await input.kernel.projectTask(input.root, child.task_id),
					child.task_id,
				);
				if (
					fresh.projection.lifecycle === "done" &&
					fresh.projection.completion_ready
				)
					return { ...child, state: "settled" as const, reason: null };
				if (fresh.error === null && fresh.claim?.task_id === child.task_id) {
					return input.kernel.ownsTaskClaim(child.task_id)
						? { ...child, state: "enrolled" as const, reason: null }
						: child;
				}
				return { ...child, state: "pending" as const, reason: null };
			}),
		);
		// A parked child whose Kernel claim was re-bound to a foreign batch
		// keeps the batch parked: resuming would select an independent sibling
		// while that claim is still open.
		if (remapped.some((child) => child.state === "needs_human")) {
			// review-1(7th round): a re-parked foreign-claim child re-marks its
			// transitive dependents skipped_blocked at re-park time, healing a
			// prior park site that missed the marking. Only pending dependents
			// are touched; already-skipped and terminal children stay as-is.
			const reparked: BatchRunStateRecord = { ...existing, children: remapped };
			for (const parked of remapped) {
				if (parked.state === "needs_human")
					skipDependents(
						reparked,
						parked.task_id,
						`dependency ${parked.task_id} parked`,
					);
			}
			existing = writeBatchRunState(input.root, {
				...reparked,
				confirmation_time: input.confirmation_time,
				authorization_expires_at: input.authorization_expires_at,
				budget: input.budget,
				batch_state: "needs_human",
			});
			return finalize(
				input.root,
				existing,
				"a parked child's Kernel claim is held by a foreign batch",
				"Resolve the foreign claim, then re-confirm the batch to continue.",
			);
		}
		const resumedChildren = remapped.map((child) =>
			child.state === "skipped_blocked"
				? { ...child, state: "pending" as const, reason: null }
				: child,
		);
		existing = writeBatchRunState(input.root, {
			...existing,
			confirmation_time: input.confirmation_time,
			authorization_expires_at: input.authorization_expires_at,
			budget: input.budget,
			batch_state: "running",
			consecutive_qa_failures: 0,
			children: resumedChildren,
		});
	}

	// A running batch can outlive its authorization while it waits on a child's
	// reserved foreground Review. The driver owns every batch state transition,
	// so the renewal the Host bound into the capability must be adopted here;
	// otherwise the record keeps the expired stamp and the next child enrollment
	// stops the batch as budget_stopped even though the literal user just
	// re-confirmed it. Renewal requires the same proof the parked path requires:
	// a strictly newer literal-user confirmation and a later, still-valid expiry.
	if (existing?.batch_state === "running") {
		const nextConfirmation = Date.parse(input.confirmation_time);
		const nextExpiry = Date.parse(input.authorization_expires_at);
		const priorConfirmation = Date.parse(existing.confirmation_time);
		const persistedExpiry = Date.parse(existing.authorization_expires_at);
		const renewedAuthorization =
			Number.isFinite(nextConfirmation) &&
			nextConfirmation > priorConfirmation &&
			Number.isFinite(nextExpiry) &&
			nextExpiry > Date.now() &&
			nextExpiry > persistedExpiry;
		if (renewedAuthorization) {
			validateRunAuthorization(input, existing);
			existing = writeBatchRunState(input.root, {
				...existing,
				confirmation_time: input.confirmation_time,
				authorization_expires_at: input.authorization_expires_at,
				budget: input.budget,
			});
		}
	}

	// review-2(6th round): an enrolled or settled child from an interrupted
	// run must be driven to its own terminal settlement and commit before any
	// new child is selected, or startBatch would double-claim the task or
	// falsely mark the batch completed while a Kernel claim is still open.
	// resumeBatch drives that child to a terminal transition and then falls
	// through to this function's normal loop, so the delegation terminates.
	if (existing) {
		const interruptedChild = existing.children.find(
			(child) => child.state === "enrolled" || child.state === "settled",
		);
		if (interruptedChild) {
			return await resumeBatch(input, (root, taskId) =>
				input.kernel.projectTask(root, taskId),
			);
		}
	}

	if (!existing) {
		try {
			validateRunAuthorization(input, null);
		} catch (error) {
			return reportFor(
				{ ...prepareBatchRunState(input), batch_state: "rejected" },
				error instanceof Error ? error.message : String(error),
				"Correct the authorization or plan, then re-confirm the batch.",
			);
		}

		// Mandatory batch branch preflight: run before any child is enrolled.
		const preflightResult = input.git?.preflight
			? await input.git.preflight({
				root: input.root,
				initiative_slug: input.initiative_slug,
				base_head: input.base_head,
			})
			: input.kernel.gitPreflight
				? await input.kernel.gitPreflight({
					root: input.root,
					initiative_slug: input.initiative_slug,
					base_head: input.base_head,
				})
				: runBatchGitPreflight({
					root: input.root,
					initiative_slug: input.initiative_slug,
					base_head: input.base_head,
				});

		if (!preflightResult.ok) {
			const rejected = prepareBatchRunState({ ...input, now: input.now });
			return reportFor(
				{ ...rejected, batch_state: "rejected" },
				preflightResult.reason,
				preflightResult.message || "Correct the preflight condition and re-confirm.",
			);
		}
	}
	let record: BatchRunStateRecord =
		existing ??
		prepareBatchRunState({
			batch_id: input.batch_id,
			initiative_slug: input.initiative_slug,
			children: input.children,
			plan_digest: input.plan_digest,
			base_head: input.base_head,
			confirmation_time: input.confirmation_time,
			authorization_expires_at: input.authorization_expires_at,
			budget: input.budget,
			now: input.now,
		});

	const persist = (): void => {
		record = writeBatchRunState(input.root, record);
	};

	if (record.batch_state === "prepared") {
		record.batch_state = "running";
		persist();
	}

	let head = record.commits.length
		? record.commits[record.commits.length - 1]!
		: record.base_head;

	// Validate current Git HEAD and branch against the expected head/branch before continuing (review rounds 7+11)
	const driftMessage = externalHeadDriftMessage(input.root, record);
	if (driftMessage) {
		record.batch_state = "failed";
		persist();
		return finalize(input.root, record, driftMessage, "");
	}

	while (record.batch_state === "running") {
		const child = nextEnrollableChild(record);
		if (!child) {
			record.batch_state = record.children.some(
				(c) => c.state === "needs_human" || c.state === "skipped_blocked",
			)
				? "needs_human"
				: "completed";
			persist();
			break;
		}

		// Enroll through the batch-derived capability.
		// review-1(2nd round): the child is marked enrolled only after
		// enrollTask succeeds, so an interruption before enrollment leaves the
		// child pending and resume never fabricates a Kernel claim.
		// review-2(5th round): a crash between durable enrollTask and the
		// enrolled-persist leaves the child persisted as pending. Re-enrolling
		// would double-claim, so reconcile against a fresh Kernel projection
		// first: a pending child that already holds this batch's claim is
		// adopted as enrolled without a second enrollment mutation.
		// review-2(5th round): a crash between durable enrollTask and the
		// enrolled-persist leaves the child persisted as pending. Re-enrolling
		// would double-claim, so reconcile against a fresh Kernel projection
		// first: a pending child that already holds this batch's claim is
		// adopted as enrolled without a second enrollment mutation.
		// review-1(6th round): a pending child whose claim is held by another
		// batch must not be adopted (claim theft) and must not be re-enrolled
		// (claim fight). Park it for human resolution instead.
		let adoptedClaim = false;
		let claimState: "none" | "ours" | "foreign" = "none";
		const fresh = requireFreshProjection(
			await input.kernel.projectTask(input.root, child.task_id),
			child.task_id,
		);
		if (fresh.claim !== null && fresh.claim.task_id === child.task_id) {
			claimState = input.kernel.ownsTaskClaim(child.task_id) ? "ours" : "foreign";
		}
		if (claimState === "ours") {
			adoptedClaim = true;
		} else if (claimState === "foreign") {
			record.children = record.children.map((c) =>
				c.task_id === child.task_id
					? { ...c, state: "needs_human", reason: "claim held by another batch" }
					: c,
			);
			// review-7: a park takes the parked child's whole dependent subtree
			// out of the run, including on this foreign-claim path.
			skipDependents(record, child.task_id, `dependency ${child.task_id} parked`);
			record.batch_state = "needs_human";
			persist();
			return finalize(input.root, record, "claim held by another batch", "needs-human-attention");
		}
		if (adoptedClaim) {
			record.children = record.children.map((c) =>
				c.task_id === child.task_id
					? { ...c, state: "enrolled", reason: "adopted existing batch claim after interruption" }
					: c,
			);
			persist();
		} else {
		// Re-read the clock after projection; an adopted claim is not a new enrollment.
		const now = Date.now();
		if (now >= Date.parse(record.authorization_expires_at) || budgetStopReason(record, now)) {
			record.batch_state = record.children.some(
				(c) => c.state === "needs_human" || c.state === "skipped_blocked",
			) ? "needs_human" : "budget_stopped";
			persist();
			break;
		}
		try {
			// A new capability has no in-memory consumption history. Restore only
			// slots backed by this batch's independently queried commit evidence.
			await validatePersistedRun(input, record);
			const { issued_at: _issuedAt, ...binding } = input.kernel.validateBatchAuthorization({
				registry: input.registry,
				capability: input.capability,
				binding: {
					batch_id: record.batch_id, plan_digest: record.plan_digest,
					base_head: record.base_head, initiative_slug: record.initiative_slug,
					budget: record.budget, expires_at: record.authorization_expires_at,
				},
			});
			for (const committed of record.children) {
				if (committed.state === "committed" && !input.registry.isChildConsumed(input.capability, committed.task_id))
					input.registry.consumeChild(input.capability, binding, committed.task_id);
			}
			await input.kernel.enrollTask({
				root: input.root,
				task_id: child.task_id,
				batch: {
					registry: input.registry,
					capability: input.capability,
					binding: { batch_id: input.batch_id, expected_head: head },
				},
			});
			record.children = record.children.map((c) =>
					c.task_id === child.task_id ? { ...c, state: "enrolled" } : c,
			);
			persist();
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			// Only a typed BatchAuthorizationExpiryError is an intentional
			// budget stop; free-form message matching misclassified
			// infrastructure and validation failures as intentional stops.
			if (isAuthorizationExpiryError(error)) {
				record.children = record.children.map((c) =>
					c.task_id === child.task_id ? { ...c, state: "pending", reason: message } : c,
				);
				record.batch_state = "budget_stopped";
				persist();
				break;
			}
			// review round 10: external HEAD movement after the pre-loop check
			// (including between children) fails the batch, it never parks.
			if (isLineageBreakError(message)) {
				record.children = record.children.map((c) =>
					c.task_id === child.task_id ? { ...c, state: "needs_human", reason: message } : c,
				);
				skipDependents(record, child.task_id, `dependency ${child.task_id} parked`);
				record.batch_state = "failed";
				persist();
				break;
			}
			record.children = record.children.map((c) =>
				c.task_id === child.task_id ? { ...c, state: "needs_human", reason: message } : c,
			);
			// A park ends the run immediately: the parked child may still hold
			// the sole Kernel claim, so selecting an independent sibling would
			// fail its claim projection.
			skipDependents(record, child.task_id, `dependency ${child.task_id} parked`);
			record.batch_state = "needs_human";
			persist();
			break;
		}
		}
	// Drive the child through the Kernel obligation surface only; rework
		// below the limit retries the same child in this inner loop.
		let childTerminal = false;
		while (!childTerminal) {
		const terminal = await input.kernel.advanceTask(input.root, child.task_id);
		if (terminal.state === "completed") {
			childTerminal = true;
			// review-6: a successful settlement resets the consecutive-QA-failure
			// counter so separated failures do not park later children.
			record.consecutive_qa_failures = 0;
			record.children = record.children.map((c) =>
				c.task_id === child.task_id ? { ...c, state: "settled", reason: null } : c,
			);
			persist();
			// Scope-bound commit; a lineage failure fails the whole batch.
			try {
				const planChild = input.children.find((c) => c.task_id === child.task_id);
				const intentPath = planChild?.intent_path ?? undefined;
				const { commit } = input.git?.commitChild
					? await input.git.commitChild(input.root, child.task_id, input.batch_id, head, record.branch, intentPath)
					: input.kernel.commitChild
						? await input.kernel.commitChild(input.root, child.task_id, input.batch_id, head, record.branch, intentPath)
						: await commitBatchChild({
							root: input.root,
							taskId: child.task_id,
							batchId: input.batch_id,
							expectedHead: head,
							branch: record.branch,
							intentPath,
						});
				record.children = record.children.map((c) =>
					c.task_id === child.task_id ? { ...c, state: "committed", commit } : c,
				);
				record.commits.push(commit);
				head = commit;
				persist();
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				record.children = record.children.map((c) =>
					c.task_id === child.task_id ? { ...c, state: "needs_human", reason: message } : c,
				);
				// review-4: a commit failure is terminal; dependents must be
				// skipped_blocked, not left pending.
				skipDependents(record, child.task_id, `dependency ${child.task_id} failed to commit`);
				record.batch_state = "failed";
				persist();
				break;
			}
		} else if (terminal.state === "stopped") {
			record.children = record.children.map((c) =>
				c.task_id === child.task_id
					? { ...c, state: "needs_human", reason: "Kernel reported the child stopped" }
					: c,
			);
			childTerminal = true;
			skipDependents(record, child.task_id, `dependency ${child.task_id} parked`);
			record.batch_state = "needs_human";
			persist();
		} else if (terminal.state === "rework" && terminal.operation === "qa") {
			record.consecutive_qa_failures += 1;
			if (record.consecutive_qa_failures >= record.budget.qa_failure_limit) {
				record.children = record.children.map((c) =>
					c.task_id === child.task_id
						? { ...c, state: "needs_human", reason: `QA failure limit reached: ${terminal.summary}` }
						: c,
				);
				record.batch_state = "needs_human";
				childTerminal = true;
				skipDependents(record, child.task_id, `dependency ${child.task_id} parked`);
				persist();
			} else {
				// Below the limit: the inner loop re-drives the same child.
				persist();
			}
		} else if (terminal.state === "failed" || terminal.state === "blocked" || terminal.state === "rework") {
			const reason = terminal.state === "rework" ? terminal.summary : terminal.reason;
			childTerminal = true;
			record.children = record.children.map((c) =>
				c.task_id === child.task_id ? { ...c, state: "needs_human", reason } : c,
			);
			skipDependents(record, child.task_id, `dependency ${child.task_id} parked`);
			record.batch_state = "needs_human";
			persist();
		} else if (terminal.state === "review_ready") {
			// A foreground Review reservation is owned by the calling host
			// turn; the batch pauses here without parking the child.
			record.children = record.children.map((c) =>
				c.task_id === child.task_id
					? { ...c, state: "enrolled", reason: `review reservation ${terminal.operation_id} open` }
					: c,
			);
			persist();
			return reportFor(
				record,
				`child ${child.task_id} holds an open Review reservation`,
				"Submit the reserved foreground Review verdict, then call startBatch again to continue.",
			);
		}
		}
	}

	return finalize(input.root, record, stopReasonFor(record), "");
}

function stopReasonFor(record: BatchRunStateRecord): string | null {
	switch (record.batch_state) {
		case "budget_stopped":
			return (
				budgetStopReason(record, Date.now()) ??
				"budget, deadline, or authorization expiry stopped new enrollments"
			);
		case "failed": {
			const failedChild = record.children.find((c) => c.state === "needs_human" && c.reason);
			return failedChild?.reason ?? "a commit or lineage failure stopped the batch";
		}
		case "needs_human":
			return "a parked child needs a human decision";
		case "completed":
			return "all enrollable children committed";
		default:
			return null;
	}
}

/**
 * review-1: resume the interrupted child first. A persisted enrolled child
 * is driven through the Kernel obligation surface to its own terminal
 * settlement and commit before any new enrollment or expiry check, so an
 * interrupted run can never falsely complete or enroll a sibling while a
 * child claim is still open. Never replays a committed mutation; refuses an
 * expired authorization by requiring a new literal-user confirmation.
 */
export async function resumeBatch(
	input: StartBatchInput,
	projection: (root: string, taskId: string) => Promise<AssuranceProjectionResult>,
): Promise<BatchRunReport> {
	let existing = readBatchRunState(input.root, input.batch_id);
	if (!existing) return startBatch(input);
	try {
		await validatePersistedRun(input, existing);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (isLineageBreakError(message)) {
			if (isTerminalBatchState(existing.batch_state)) return replayTerminal(input.root, existing);
			const failed = failPersistedLineage(input.root, existing, message);
			return finalize(input.root, failed, message, "");
		}
		throw error;
	}
	if (isTerminalBatchState(existing.batch_state))
		return replayTerminal(input.root, existing);
	if (existing.batch_state === "needs_human") return startBatch(input);

	// An enrolled-but-unsettled child must reach its own Kernel terminal
	// settlement before anything else, even under an expired authorization:
	// its claim is already held and the Kernel owns its remaining obligations.
	// review-1(2nd round): an `enrolled` child is verified against a fresh
	// Kernel projection; a projection that finds no active claim means the
	// persisted `enrolled` flag predates a successful enrollment, so the child
	// returns to pending instead of being driven without a claim.
	// Pending children are reconciled by the normal loop using its dependency-aware
	// selection rule. Only a persisted in-flight child needs this recovery path.
	const driven = existing.children.find(
		(child) => child.state === "enrolled" || child.state === "settled",
	);
	if (driven) {
		if (driven.state === "enrolled") {
			// review round 11: verify external HEAD/branch lineage before Kernel
			// advancement of an enrolled child. review round 12: a settled child
			// defers to driveInterruptedChild's lookupBatchCommit verification,
			// which adopts a verified own commit (crash before committed-persist)
			// instead of misjudging it as external drift.
			const drivenDrift = externalHeadDriftMessage(input.root, existing);
			if (drivenDrift) {
				const failed = failPersistedLineage(input.root, existing, drivenDrift);
				return finalize(input.root, failed, drivenDrift, "");
			}
			const fresh = requireFreshProjection(
				await input.kernel.projectTask(input.root, driven.task_id),
				driven.task_id,
			);
			const holdsClaim =
				fresh.claim !== null &&
				fresh.claim.task_id === driven.task_id &&
				input.kernel.ownsTaskClaim(driven.task_id);
			if (holdsClaim === false && fresh.claim !== null && fresh.claim.task_id === driven.task_id && !input.kernel.ownsTaskClaim(driven.task_id)) {
				// review-2(6th round): the claim on this child is held by
				// another batch. Never advance a foreign claim; park for human.
				// review-7: skip the parked child's dependent subtree too.
				skipDependents(existing, driven.task_id, `dependency ${driven.task_id} parked`);
				existing = writeBatchRunState(input.root, {
					...existing,
					batch_state: "needs_human",
					children: existing.children.map((c) =>
						c.task_id === driven.task_id
							? { ...c, state: "needs_human", reason: "claim held by another batch" }
						: c,
				),
				});
				return finalize(input.root, existing, "claim held by another batch", "needs-human-attention");
			}
			if (!holdsClaim) {
				// review-1(4th round): a claimless projection still carries a
				// projection body when the task is a terminal owner. If the fresh
				// projection shows the child already reached its Kernel terminal
				// settlement (lifecycle done), the persisted `enrolled` flag
				// predates a crash between advanceTask and state persistence:
				// settle the child here so resume continues at the commit
				// obligation instead of re-enrolling completed work.
				const settledRemotely =
					fresh.projection.lifecycle === "done" &&
					fresh.projection.completion_ready === true;
				if (settledRemotely) {
					existing = writeBatchRunState(input.root, {
						...existing,
						children: existing.children.map((c) =>
							c.task_id === driven.task_id
								? { ...c, state: "settled", reason: "crash after settlement; resuming at commit" }
								: c,
					),
					});
				} else {
					// No Kernel claim and no terminal settlement: the enrollment
					// never completed. Re-mark the child pending so the normal
					// loop re-enrolls it through the batch-derived capability.
					existing = writeBatchRunState(input.root, {
						...existing,
						children: existing.children.map((c) =>
							c.task_id === driven.task_id
								? { ...c, state: "pending", reason: "enrollment did not complete; re-enrolling" }
								: c,
					),
					});
				}
			}
		}
			// review-2(3rd round): re-read the child from the persisted record so
			// the re-marked pending child is never driven with the stale enrolled
			// object captured before the state write.
			const current =
				existing.children.find((c) => c.task_id === driven.task_id) ?? driven;
			if (current.state === "settled" || current.state === "enrolled") {
				try {
					const driven = await driveInterruptedChild(input, current);
					if (driven) return driven;
				} catch (error) {
					if (error instanceof BatchCommitAbortError) {
						const failed = readBatchRunState(input.root, input.batch_id)!;
						return finalize(input.root, failed, error.message, "");
					}
					throw error;
				}
			}
		// review-3(2nd round): driveInterruptedChild persisted its own
		// transitions; reload the record so the final state below reflects
		// the persisted child states, not the stale pre-recovery snapshot.
		existing = readBatchRunState(input.root, input.batch_id)!;
		if (isTerminalBatchState(existing.batch_state))
			return replayTerminal(input.root, existing);
	}

	// No interrupted child remains: continue with the normal serial loop.
	return startBatch(input);
}

/**
 * Drive one interrupted child (enrolled or settled) to its own terminal
 * settlement and commit. Returns a report when the child reached a state the
 * driver must stop on (review_ready, failure, park), or null to continue the
 * outer run afterwards.
 */
class BatchCommitAbortError extends Error {}

async function driveInterruptedChild(
	input: StartBatchInput,
	child: BatchChildRun,
): Promise<BatchRunReport | null> {
	let record = readBatchRunState(input.root, input.batch_id)!;
	const persist = (): void => {
		record = writeBatchRunState(input.root, record);
	};
	if (record.batch_state === "prepared") {
		record.batch_state = "running";
		persist();
	}
	let head = record.commits.length
		? record.commits[record.commits.length - 1]!
		: record.base_head;
	while (child.state === "enrolled" || child.state === "settled") {
		if (child.state === "settled") {
			// review-2(2nd round): a persisted settled child must not replay
			// Kernel advancement; proceed directly to its scope-bound commit.
			// review-3(5th round): a crash after commitChild created the commit
			// but before committed-persist replays commitChild on resume. Adopt
			// the existing batch commit idempotently instead of mutating again.
			let existing: { commit: string } | null = null;
			// review-1(6th round): a lookup failure must fail closed, not fall
			// through to commitChild, which could replay an existing commit.
			try {
				existing = input.git?.lookupBatchCommit
					? await input.git.lookupBatchCommit(input.root, child.task_id, input.batch_id, head, record.branch)
					: input.kernel.lookupBatchCommit
						? await input.kernel.lookupBatchCommit(
							input.root,
							child.task_id,
							input.batch_id,
							head,
							record.branch,
						)
						: await lookupBatchCommit({
							root: input.root,
							taskId: child.task_id,
							batchId: input.batch_id,
							expectedHead: head,
							branch: record.branch,
						});
			} catch (error: unknown) {
				const message =
					error instanceof Error ? error.message : String(error);
				record.children = record.children.map((c) =>
					c.task_id === child.task_id
						? { ...c, state: "needs_human", reason: `commit lookup failed: ${message}` }
						: c,
				);
				// review-1(7th round): the commit-lookup park is a park site too;
				// its transitive dependents become skipped_blocked like every
				// other park, never left pending.
				skipDependents(
					record,
					child.task_id,
					`dependency ${child.task_id} failed to commit`,
				);
				const isLineageError =
					message.includes("batch_head_lineage_broken") || message.includes("lineage");
				record.batch_state = isLineageError ? "failed" : "needs_human";
				persist();
				throw new BatchCommitAbortError(`commit lookup failed: ${message}`);
			}
			const planChild = input.children.find((c) => c.task_id === child.task_id);
			const intentPath = planChild?.intent_path ?? undefined;
			const doCommit = async () => {
				if (input.git?.commitChild) {
					return input.git.commitChild(input.root, child.task_id, input.batch_id, head, record.branch, intentPath);
				}
				if (input.kernel.commitChild) {
					return input.kernel.commitChild(input.root, child.task_id, input.batch_id, head, record.branch, intentPath);
				}
				return commitBatchChild({
					root: input.root,
					taskId: child.task_id,
					batchId: input.batch_id,
					expectedHead: head,
					branch: record.branch,
					intentPath,
				});
			};
			const adopted =
				existing ??
				(await doCommit().catch((error: unknown) => {
					const message = error instanceof Error ? error.message : String(error);
					record.children = record.children.map((c) =>
						c.task_id === child.task_id
							? { ...c, state: "needs_human", reason: message }
							: c,
					);
					// review-4: dependents are skipped_blocked, not left pending.
					skipDependents(
						record,
						child.task_id,
						`dependency ${child.task_id} failed to commit`,
					);
					record.batch_state = "failed";
					persist();
					throw new BatchCommitAbortError(message);
				}));
			const { commit } = adopted;
			record.children = record.children.map((c) =>
				c.task_id === child.task_id ? { ...c, state: "committed", commit } : c,
			);
			record.commits.push(commit);
			head = commit;
			persist();
			child = { ...child, state: "committed", commit };
			continue;
		}
		const terminal = await input.kernel.advanceTask(input.root, child.task_id);
		if (terminal.state === "completed") {
			record.children = record.children.map((c) =>
				c.task_id === child.task_id ? { ...c, state: "settled", reason: null } : c,
			);
			record.consecutive_qa_failures = 0;
			persist();
			try {
				const planChild = input.children.find((c) => c.task_id === child.task_id);
				const intentPath = planChild?.intent_path ?? undefined;
				const { commit } = input.git?.commitChild
					? await input.git.commitChild(input.root, child.task_id, input.batch_id, head, record.branch, intentPath)
					: input.kernel.commitChild
						? await input.kernel.commitChild(input.root, child.task_id, input.batch_id, head, record.branch, intentPath)
						: await commitBatchChild({
							root: input.root,
							taskId: child.task_id,
							batchId: input.batch_id,
							expectedHead: head,
							branch: record.branch,
							intentPath,
						});
				record.children = record.children.map((c) =>
					c.task_id === child.task_id ? { ...c, state: "committed", commit } : c,
				);
				record.commits.push(commit);
				head = commit;
				persist();
				child = { ...child, state: "committed", commit };
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				record.children = record.children.map((c) =>
					c.task_id === child.task_id ? { ...c, state: "needs_human", reason: message } : c,
				);
				// review-4: dependents are skipped_blocked, not left pending.
				skipDependents(record, child.task_id, `dependency ${child.task_id} failed to commit`);
				record.batch_state = "failed";
				persist();
				return finalize(input.root, record, message, "");
			}
		} else if (terminal.state === "review_ready") {
			record.children = record.children.map((c) =>
				c.task_id === child.task_id
					? { ...c, reason: `review reservation ${terminal.operation_id} open` }
					: c,
			);
			persist();
			// A foreground Review reservation stays with the calling host turn.
			return reportFor(
				record,
				`child ${child.task_id} holds an open Review reservation`,
				"Submit the reserved foreground Review verdict, then call startBatch again to continue.",
			);
		} else if (terminal.state === "rework" && terminal.operation === "qa") {
			// review-3(3rd round): interrupted-child rework applies the same
			// consecutive-failure limit as startBatch instead of parking on the
			// first rework; below the limit the loop re-drives the same child.
			record.consecutive_qa_failures += 1;
			if (record.consecutive_qa_failures >= record.budget.qa_failure_limit) {
				const reason = `QA failure limit reached: ${terminal.summary}`;
				record.children = record.children.map((c) =>
					c.task_id === child.task_id ? { ...c, state: "needs_human", reason } : c,
				);
				record.batch_state = "needs_human";
				skipDependents(record, child.task_id, `dependency ${child.task_id} parked`);
				persist();
				return finalize(input.root, record, reason, "");
			}
			persist();
		} else {
			// stopped | failed | blocked: park and stop.
			const reason =
				terminal.state === "stopped" ? "Kernel reported the child stopped"
					: terminal.state === "rework" ? terminal.summary : terminal.reason;
			record.children = record.children.map((c) =>
				c.task_id === child.task_id ? { ...c, state: "needs_human", reason } : c,
			);
			record.batch_state = "needs_human";
			skipDependents(record, child.task_id, `dependency ${child.task_id} parked`);
			persist();
			return finalize(input.root, record, reason, "");
		}
	}
	// Child committed; continue the outer run afterwards.
	return null;
}
