// Serial batch run driver for unattended Initiative batch runs.
// Every batch and child state transition lives here and in
// runtime/kernel/batch_authority.ts; Host adapters are callers only and this
// module imports no Host adapter (Invariant H-1).
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
	type BatchAuthorityRegistry,
	type ValidatedBatchAuthorization,
	computeBatchPlanDigest,
} from "../kernel/batch_authority";
import type { AssuranceProjectionResult } from "../kernel/assurance_projection";
import type { TaskRecord } from "../kernel/types";
import { deriveAssuranceRecovery, type AssuranceRecovery, type TaskRecordRead } from "../assurance/coordinator";
import type { QaCheckDiagnostic } from "../assurance/qa";

/** Failed atomic QA attempts observed through Kernel history, including Parent-driven QA. */
export function batchQaFailureFacts(record: Pick<TaskRecord, "history"> & { findings: NonNullable<TaskRecordRead["record"]>["findings"] }) {
	const failed = record.history.filter((event) => event.type === "request_rework" && event.authority?.authority_kind === "qa");
	return { qa_failure_count: failed.length, last_qa_failure_at: failed.at(-1)?.at ?? null,
		recovery_findings: record.findings.filter(f => f.status === "open").map(f => ({ id: f.id, kind: f.kind, status: f.status, acceptance_id: f.acceptance_id })) };
}
import type { BatchPlanChild } from "./types";
import { ownUnpersistedBatchHead, takeReconfirmation } from "./batch_reconfirmation";
import {
	createDefaultBatchGitPort,
	type BatchRunnerGitPort,
} from "./batch_git";
import { classifyBatchLineage, expectedBatchHead } from "./batch_preflight";
import { laneRejectionReport, runLaneBatch, type LaneOffer } from "./batch_lanes";
import {
	type BatchRunStateRecord,
	type BatchChildRun,
	type BatchRunReport,
	isLaneBatchRecord,
	isTerminalBatchState,
	readAnyBatchRunState,
	prepareBatchRunState,
	readBatchRunState,
	writeBatchRunState,
	replaceBatchRunState,
	writeBatchRunReport,
} from "./batch_state";

/** Kernel-facing ports the driver needs. Host adapters supply these. Git
 * operations are not Kernel-port members: the runner drives them through
 * BatchRunnerGitPort alone (D5 of docs/specs/deepen-authority-seams.spec.md). */
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
	/** review-2(5th round): read-only claim projection for enrollment
	 * reconciliation after an interruption between enrollTask and its state
	 * persistence. Uses the real AssuranceProjectionResult contract; batch
	 * ownership of the claim is verified separately through the authoritative
	 * batch registry, because the Kernel claim carries no batch id. */
	projectTask(root: string, taskId: string): Promise<AssuranceProjectionResult & { qa_failure_count?: number; last_qa_failure_at?: string | null; recovery_findings?: NonNullable<TaskRecordRead["record"]>["findings"] }>;
	/** Authoritative batch ownership check: true when the task's Kernel claim
	 * is held under this batch's derived capability (consumed child slot). */
	ownsTaskClaim(taskId: string): boolean;
	/** review-8(4th rework): Kernel-side proof that a replacement parked-batch
	 * authorization is genuine and bound to this exact batch_id,
	 * plan_digest, and base_head, validated against the Kernel's authoritative
	 * binding state. Throws on fabrication or mismatch; the driver
	 * must call this before accepting a parked-batch resume. */
	validateBatchAuthorization(input: {
		registry: BatchAuthorityRegistry;
		capability: object;
		binding: Pick<ValidatedBatchAuthorization,
			"batch_id" | "plan_digest" | "base_head" | "initiative_slug" | "budget">;
	}): ValidatedBatchAuthorization;
}

export type BatchChildAdvanceResult = { diagnostics?: QaCheckDiagnostic[]; environment_failure?: boolean; recovery?: AssuranceRecovery } & (
	| { state: "completed" }
	| { state: "stopped" }
	| { state: "failed"; reason: string }
	| { state: "rework"; operation: "qa" | "review"; summary: string }
	| { state: "blocked"; reason: string }
	| { state: "review_ready"; operation_id: string }
	| { state: "review_preparation_failed"; operation: "review"; operation_id: string; reason: string });

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
	budget: { max_children: number; qa_failure_limit: number };
	now: string;
	kernel: BatchRunnerKernelPort;
	git?: BatchRunnerGitPort;
	/** Present only in lane mode: how many children may run at once. */
	max_parallel?: number;
	/** Present only in lane mode: Lanes someone else created, offered to the batch. */
	lane_offers?: LaneOffer[];
	/**
	 * Lane mode only: the opted-in tracker projection the coordinator runs after
	 * integrating a child. A Lane settlement writes nothing to the tracker, so
	 * this is where its Child Issue is closed, exactly once. Absent, nothing is
	 * projected.
	 */
	tracker?: BatchTrackerPort;
	/**
	 * Lane mode only: the plugin or runtime directory the Lane Executor Host
	 * loads. Absent, the repository's own plugin source is compared when the
	 * repository is the Immune-Brain package; otherwise nothing is compared.
	 */
	executor_runtime?: string;
	/**
	 * Lane mode only: the project's full verification commands, recorded when a
	 * new batch starts and run on the batch branch once every child is
	 * integrated. Ignored on a resume; the recorded list stands.
	 */
	final_verification?: string[];
	/**
	 * Lane mode only: one text instruction the Parent wants to send a Lane
	 * session. The tick records it and answers whether it may be sent; it is
	 * never sent to a blocked or working session.
	 */
	lane_instruction?: import("./batch_lanes").LaneInstructionRequest;
}

/** The one tracker effect a lane batch may cause: closing an integrated child's Issue. */
export interface BatchTrackerPort {
	markTerminal(
		root: string,
		input: { task_id: string; phase: "done"; terminal_event_id: string },
	): Promise<{ status: string; message: string }>;
}

/** One git seam: the injected BatchRunnerGitPort, or the default adapter over
 * the real repository operations when the Host supplies none. */
function batchGitPortOf(input: StartBatchInput): BatchRunnerGitPort {
	return input.git ?? createDefaultBatchGitPort();
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

function budgetStopReason(record: BatchRunStateRecord): string | null {
	// review-3: budget counts enrollments consumed (children that left
	// pending), not commits, so parked children still consume authorization.
	const enrolledCount = record.children.filter(
		(child) => child.state !== "pending" && child.state !== "skipped_blocked",
	).length;
	if (enrolledCount >= record.budget.max_children)
		return `max_children budget exhausted (${record.budget.max_children})`;
	return null;
}

function requireFreshProjection<T extends AssuranceProjectionResult>(
	result: T,
	taskId: string,
): T & { error: null } {
	if (result.error !== null)
		throw new Error(`cannot reconcile Kernel projection for ${taskId}: ${result.error}`);
	return result as T & { error: null };
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
	budget_stopped: "The child budget stopped new enrollments; re-confirm to continue under a new authorization.",
	failed: "A commit or lineage failure stopped the batch; inspect the failing child and the branch state.",
	rejected: "The batch was rejected before any enrollment; correct the stated reason and re-confirm.",
	superseded: "The plan moved past this record and an explicit disposition retired it; it grants no handoff and no child delivery.",
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

/** Derived observation only: Parent must re-read Kernel ownership before execution. */
function executorHandoff(
	record: BatchRunStateRecord,
	taskId: string,
	fresh: AssuranceProjectionResult & { error: null; recovery_findings?: NonNullable<TaskRecordRead["record"]>["findings"] },
	failure: { state?: string; environment_failure?: boolean; diagnostics?: QaCheckDiagnostic[] } = {},
): BatchRunReport {
	const recovery = deriveAssuranceRecovery(taskId, fresh, failure, fresh.recovery_findings);
	return {
		...reportFor(record, null, recovery?.next_action ?? (fresh.projection.artifact_state === "frozen"
			? "The child is frozen with pending QA. Call advance_assurance once; follow its diagnostics before retrying, then submit any reserved Review before batch continuation."
			: "Route the enrolled child to foreground Executor, implement and stage its scoped work, then call Kernel advance_assurance. Submit any reserved Review verdict before continuing start_unattended_batch with the same Initiative.")),
		...(recovery ? { recovery } : {}),
		...(failure.diagnostics?.length ? { diagnostics: failure.diagnostics } : {}),
		handoff: recovery?.category === "authorization" ? undefined : {
			role: "executor", task_id: taskId,
			run_id: fresh.projection.run_id ?? null,
			record_revision: fresh.projection.record_revision,
			next_obligation: fresh.projection.next_obligation,
		},
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
	details: Pick<BatchRunReport, "recovery" | "diagnostics"> = {},
): BatchRunReport {
	const report = { ...reportFor(record, reason, nextAction), ...details };
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

/** A HEAD that fast-forwards on the batch branch is the user's own work: adopt
 * it as the new expected head and record it. Any other movement is the fatal
 * lineage break, returned as the failure message with the record unchanged. */
function reconcileLineage(
	root: string,
	record: BatchRunStateRecord,
): { record: BatchRunStateRecord; failure: string | null } {
	if (!existsSync(join(root, ".git"))) return { record, failure: null };
	const expected = expectedBatchHead(record);
	const lineage = classifyBatchLineage({
		root,
		branch: record.branch ?? "",
		expectedHead: expected,
		childCommits: record.commits,
		batchId: record.batch_id,
	});
	if (lineage.kind === "broken") return { record, failure: lineage.message };
	if (lineage.kind === "equal") return { record, failure: null };
	return {
		record: writeBatchRunState(root, {
			...record,
			adopted_heads: [...(record.adopted_heads ?? []), { from: expected, to: lineage.head }],
		}),
		failure: null,
	};
}

async function validatePersistedRun(input: StartBatchInput, record: BatchRunStateRecord): Promise<void> {
	if (!record.commits.length && record.children[0]?.state === "settled" && existsSync(join(input.root, ".git"))) {
		const head = spawnSync("git", ["-C", input.root, "rev-parse", "HEAD"], { encoding: "utf8" });
		const live = head.stdout.trim();
		const expected = expectedBatchHead(record);
		const adoptable = () =>
			classifyBatchLineage({
				root: input.root,
				branch: record.branch ?? "",
				expectedHead: expected,
				childCommits: record.commits,
				batchId: record.batch_id,
			}).kind === "fast_forward";
		if (head.status !== 0 || (live !== expected && !ownUnpersistedBatchHead(input.root, record, live) && !adoptable()))
			throw new Error("first unpersisted batch commit provenance is invalid");
	}
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
		const git = batchGitPortOf(input);
		const evidence = await git.lookupBatchCommit(
			input.root, child.task_id, record.batch_id, undefined, record.branch,
		);
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

function validateRunAuthorization(input: StartBatchInput, existing: BatchRunStateRecord | null): ValidatedBatchAuthorization {
	const authorized = input.kernel.validateBatchAuthorization({
		registry: input.registry,
		capability: input.capability,
		binding: {
			batch_id: input.batch_id,
			plan_digest: existing?.plan_digest ?? input.plan_digest,
			base_head: existing?.base_head ?? input.base_head,
			initiative_slug: existing?.initiative_slug ?? input.initiative_slug,
			budget: input.budget,
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
	return authorized;
}

function applyPlanReconfirmation(input: StartBatchInput, existing: BatchRunStateRecord): BatchRunStateRecord {
	if (existing.plan_digest === input.plan_digest) return existing;
	const next = { ...existing, plan_digest: input.plan_digest, confirmation_time: input.confirmation_time,
		budget: input.budget };
	if (!existing.branch || input.batch_id !== existing.batch_id || input.initiative_slug !== existing.initiative_slug || input.base_head !== existing.base_head ||
		input.budget.max_children !== existing.budget.max_children || input.budget.qa_failure_limit !== existing.budget.qa_failure_limit)
		throw new Error("plan_digest mismatch: reconfirmation binding changed");
	const validate = () => {
		const plan = input.registry.children(input.capability);
		if (existing.children.length !== plan.length || plan.some((child, index) => {
			const old = existing.children[index]!, nextChild = input.children[index];
			return !nextChild || old.task_id !== child.task_id || old.slice_id !== nextChild.slice_id ||
				JSON.stringify(old.blocked_by) !== JSON.stringify(child.blocked_by) || JSON.stringify(nextChild.blocked_by) !== JSON.stringify(child.blocked_by);
		})) throw new Error("plan_digest mismatch: reconfirmation topology changed");
		const { issued_at: _issuedAt, ...binding } = validateRunAuthorization(input, { ...existing, plan_digest: input.plan_digest });
		if (binding.branch !== existing.branch) throw new Error("plan_digest mismatch: reconfirmation branch changed");
		prepareBatchRunState(input);
		return input.registry.inspect(input.capability, binding);
	};
	const authority = validate();
	const captured = takeReconfirmation(authority.nonce);
	if (captured.root !== input.root || captured.plan_digest !== input.plan_digest) throw new Error("plan_digest mismatch: captured reconfirmation does not match run input");
	return replaceBatchRunState(input.root, captured.stateBytes, next, () => { captured.assertUnchanged(); validate(); });
}

export async function startBatch(input: StartBatchInput): Promise<BatchRunReport> {
	try {
		return await startBatchLocked(input);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (!/retired file-store|kernel store|CAS mismatch|store is busy|locked/i.test(message))
			throw error;
		// A store condition the run cannot resolve stops the batch with one
		// explicit recovery action instead of escaping as an unstructured crash.
		// The rejected report keeps whatever this batch already persisted — a run
		// resumed after partial progress reports its children and commits rather
		// than an empty plan — and only a batch with no durable state reports the
		// empty plan it validated.
		return rejectionReport(input, message);
	}
}

function rejectionReport(input: StartBatchInput, reason: string): BatchRunReport {
	const persisted = (() => {
		try {
			return readAnyBatchRunState(input.root, input.batch_id);
		} catch {
			return null;
		}
	})();
	if (persisted !== null && isLaneBatchRecord(persisted))
		return laneRejectionReport(
			input,
			persisted,
			reason,
			"settle the reported kernel store condition and retry in the current Host",
		) as unknown as BatchRunReport;
	return reportFor(
		{
			...(persisted ?? prepareBatchRunState({ ...input, children: [], now: input.now })),
			batch_state: "rejected",
		},
		reason,
		"settle the reported kernel store condition and retry in the current Host",
	);
}

async function startBatchLocked(input: StartBatchInput): Promise<BatchRunReport> {
	// Lane mode is selected by `max_parallel` or by a recorded v2 batch; a batch
	// given neither keeps the serial path below unchanged.
	const recorded = readAnyBatchRunState(input.root, input.batch_id);
	if (input.max_parallel !== undefined || (recorded !== null && isLaneBatchRecord(recorded)))
		return (await runLaneBatch(input, recorded)) as unknown as BatchRunReport;

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
	const reconfirmed = existing !== null && existing.plan_digest !== input.plan_digest;
	if (existing) {
		existing = applyPlanReconfirmation(input, existing);
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
		const freshAuthorization =
			Number.isFinite(nextConfirmation) &&
			nextConfirmation > priorConfirmation;
		if (!freshAuthorization && !reconfirmed) {
			return finalize(
				input.root,
				existing,
				"the parked batch requires a fresh literal-user confirmation",
				"Resolve the parked child, then re-confirm the batch to continue.",
			);
		}

		if (!reconfirmed) validateRunAuthorization(input, existing);
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
			budget: input.budget,
			batch_state: "running",
			children: resumedChildren,
		});
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
		const preflightResult = await batchGitPortOf(input).preflight({
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

	// Validate current Git HEAD and branch against the expected head/branch before continuing (review rounds 7+11)
	const lineage = reconcileLineage(input.root, record);
	record = lineage.record;
	if (lineage.failure) {
		record.batch_state = "failed";
		persist();
		return finalize(input.root, record, lineage.failure, "");
	}
	let head = expectedBatchHead(record);

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
		// An adopted claim is not a new enrollment.
		if (budgetStopReason(record)) {
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
					budget: record.budget,
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
		const enrolled = requireFreshProjection(
			await input.kernel.projectTask(input.root, child.task_id), child.task_id,
		);
		return executorHandoff(record, child.task_id, enrolled);

	}

	return finalize(input.root, record, stopReasonFor(record), "");
}

function stopReasonFor(record: BatchRunStateRecord): string | null {
	switch (record.batch_state) {
		case "budget_stopped":
			return (
				budgetStopReason(record) ??
				"the child budget stopped new enrollments"
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
 * settlement and commit before any new enrollment, so an interrupted run can
 * never falsely complete or enroll a sibling while a child claim is still
 * open. Never replays a committed mutation.
 */
export async function resumeBatch(
	input: StartBatchInput,
	projection: (root: string, taskId: string) => Promise<AssuranceProjectionResult>,
): Promise<BatchRunReport> {
	let existing = readBatchRunState(input.root, input.batch_id);
	if (!existing || existing.batch_state === "needs_human") return startBatch(input);
	existing = applyPlanReconfirmation(input, existing);
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

	// An enrolled-but-unsettled child must reach its own Kernel terminal
	// settlement before anything else: its claim is already held and the
	// Kernel owns its remaining obligations.
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
			const drivenLineage = reconcileLineage(input.root, existing);
			existing = drivenLineage.record;
			if (drivenLineage.failure) {
				const failed = failPersistedLineage(input.root, existing, drivenLineage.failure);
				return finalize(input.root, failed, drivenLineage.failure, "");
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
			if (holdsClaim) {
				const failures = Math.max(existing.consecutive_qa_failures, fresh.qa_failure_count ?? 0);
				if (failures >= existing.budget.qa_failure_limit && fresh.last_qa_failure_at &&
					Date.parse(fresh.last_qa_failure_at) > Date.parse(existing.confirmation_time)) {
					const reason = "QA failure limit reached; repair and settle the own child through Kernel before resuming the batch";
					skipDependents(existing, driven.task_id, `dependency ${driven.task_id} parked`);
					existing = writeBatchRunState(input.root, {
						...existing, batch_state: "needs_human", consecutive_qa_failures: failures,
						children: existing.children.map((c) => c.task_id === driven.task_id ? { ...c, state: "needs_human", reason } : c),
					});
					return finalize(input.root, existing, reason, "Repair and settle the own child through Kernel, then re-confirm the batch.",
						{ recovery: deriveAssuranceRecovery(driven.task_id, fresh, {}, fresh.recovery_findings) ?? undefined });
				}
				if (failures !== existing.consecutive_qa_failures)
					existing = writeBatchRunState(input.root, { ...existing, consecutive_qa_failures: failures });
				// A failed preparation can leave frozen inputs with run_qa pending.
				// The Parent owns that attempt; batch re-entry never blindly reruns it.
				if (fresh.projection.next_obligation === "run_qa" || fresh.projection.artifact_state !== "frozen")
					return executorHandoff(existing, driven.task_id, fresh);
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
						consecutive_qa_failures: 0,
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
	let head = expectedBatchHead(record);
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
				existing = await batchGitPortOf(input).lookupBatchCommit(
					input.root, child.task_id, input.batch_id, head, record.branch,
				);
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
			if (!existing) {
				// No own commit exists yet: a fast-forward since settlement is the
				// user's work. Adopt it so this child's commit parents on it; a broken
				// lineage is left for commitChild to refuse with its own message.
				record = reconcileLineage(input.root, record).record;
				head = expectedBatchHead(record);
			}
			const planChild = input.children.find((c) => c.task_id === child.task_id);
			const intentPath = planChild?.intent_path ?? undefined;
			const doCommit = async () =>
				batchGitPortOf(input).commitChild(
					input.root, child.task_id, input.batch_id, head, record.branch, intentPath,
				);
			if (existing && !record.commits.length && existsSync(join(input.root, ".git")) && !ownUnpersistedBatchHead(input.root, record, existing.commit))
				throw new Error("first unpersisted batch commit provenance is invalid");
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
			// Use the same lookup/commit path for new settlement and crash recovery.
			child = { ...child, state: "settled", reason: null };
			continue;
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
			// first rework; below the limit implementation returns to the Parent.
			record.consecutive_qa_failures += 1;
			if (record.consecutive_qa_failures >= record.budget.qa_failure_limit) {
				const reason = "QA failure limit reached";
				record.children = record.children.map((c) =>
					c.task_id === child.task_id ? { ...c, state: "needs_human", reason } : c,
				);
				record.batch_state = "needs_human";
				skipDependents(record, child.task_id, `dependency ${child.task_id} parked`);
				persist();
				const fresh = requireFreshProjection(await input.kernel.projectTask(input.root, child.task_id), child.task_id);
				return finalize(input.root, record, reason, "Repair and settle the own child through Kernel, then re-confirm the batch.",
					{ recovery: deriveAssuranceRecovery(child.task_id, fresh, terminal, fresh.recovery_findings) ?? undefined, diagnostics: terminal.diagnostics });
			}
			persist();
			const fresh = requireFreshProjection(await input.kernel.projectTask(input.root, child.task_id), child.task_id);
			return executorHandoff(record, child.task_id, fresh, terminal);
		} else if (terminal.state === "rework" || terminal.environment_failure || terminal.state === "review_preparation_failed" || terminal.recovery?.category === "repair") {
			// Ordinary own-claim repair is a Parent handoff, not a new user gate.
			const fresh = requireFreshProjection(await input.kernel.projectTask(input.root, child.task_id), child.task_id);
			return executorHandoff(record, child.task_id, fresh, terminal);
		} else {
			// stopped | failed | blocked: park and stop.
			const reason =
				terminal.state === "stopped" ? "Kernel reported the child stopped" : terminal.reason;
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
