// Serial batch run driver for unattended Initiative batch runs.
// Every batch and child state transition lives here and in
// runtime/kernel/batch_authority.ts; Host adapters are callers only and this
// module imports no Host adapter (Invariant H-1).
import type { BatchAuthorityRegistry } from "../kernel/batch_authority";
import type { AssuranceProjectionResult } from "../kernel/assurance_projection";
import type { BatchPlanChild } from "./types";
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
	commitChild(
		root: string,
		taskId: string,
		batchId: string,
		head: string,
	): Promise<{ commit: string }>;
	/** review-3(5th round): read the already-created batch commit for a child,
	 * or null when none exists. Lets crash recovery adopt an existing commit
	 * instead of replaying the commitChild mutation. */
	lookupBatchCommit(
		root: string,
		taskId: string,
		batchId: string,
	): Promise<{ commit: string } | null>;
	/** review-2(5th round): read-only claim projection for enrollment
	 * reconciliation after an interruption between enrollTask and its state
	 * persistence. */
	projectTask(
		root: string,
		taskId: string,
	): Promise<{
		error: string | null;
		claim: { task_id: string; batch_id: string | null } | null;
	}>;
}

export type BatchChildAdvanceResult =
	| { state: "completed" }
	| { state: "stopped" }
	| { state: "failed"; reason: string }
	| { state: "rework"; summary: string }
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
}

export type { BatchRunReport } from "./batch_state";

function dependentsOf(record: BatchRunStateRecord, taskId: string): BatchChildRun[] {
	return record.children.filter((child) => child.blocked_by.includes(taskId));
}

function skipDependents(record: BatchRunStateRecord, taskId: string, reason: string): void {
	// review-1(5th round): traverse the full transitive dependency closure —
	// parking A must skip B *and* C in A -> B -> C, not only direct dependents.
	const skip = new Set<string>();
	const queue = [taskId];
	while (queue.length > 0) {
		const current = queue.shift()!;
		for (const dependent of dependentsOf(record, current)) {
			if (dependent.state !== "pending" || skip.has(dependent.task_id)) continue;
			skip.add(dependent.task_id);
			queue.push(dependent.task_id);
		}
	}
	record.children = record.children.map((child) =>
		skip.has(child.task_id) ? { ...child, state: "skipped_blocked", reason } : child,
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

/** review-5(2nd round): a typed expiry marker for intentional budget stops. */
export class BatchAuthorizationExpiryError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "BatchAuthorizationExpiryError";
	}
}

function isAuthorizationExpiryError(error: unknown): boolean {
	return error instanceof BatchAuthorizationExpiryError;
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

/** review-5: persist exactly one terminal report at a terminal transition.
 * review-6: terminal replay idempotently ensures the report exists, so a
 * crash between the state write and the report write cannot permanently
 * violate the one-report contract. */
function finalize(
	root: string,
	record: BatchRunStateRecord,
	reason: string | null,
	nextAction: string,
): BatchRunReport {
	const report = reportFor(record, reason, nextAction);
	if (isTerminalBatchState(record.batch_state)) writeBatchRunReport(root, report);
	return report;
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

export async function startBatch(input: StartBatchInput): Promise<BatchRunReport> {
	// Validation failure before the first enrollment: zero writes, rejected.
	if (!input.children.length) {
		const rejected = prepareBatchRunState({ ...input, children: [], now: input.now });
		return finalize(
			input.root,
			{ ...rejected, batch_state: "rejected" },
			"batch plan is empty",
			"Provide a non-empty enrollable child plan.",
		);
	}

	const existing = readBatchRunState(input.root, input.batch_id);
	if (existing && isTerminalBatchState(existing.batch_state)) {
		// Idempotent terminal replay: no state mutation, ensure the report.
		return replayTerminal(input.root, existing);
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
	let parked = false;

	while (record.batch_state === "running") {
		const now = Date.now();

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

		// Expiry, deadline, and budget stop only the enrollment of a new child.
		// A parked child keeps the batch in needs_human even when the budget is
		// exhausted: the human decision must stay visible, and the budget only
		// gates new enrollments (review-3).
		const expiry = Date.parse(record.authorization_expires_at);
		const budgetStop = budgetStopReason(record, now);
		const parkedChild = record.children.some(
			(c) => c.state === "needs_human" || c.state === "skipped_blocked",
		);
		if ((!Number.isNaN(expiry) && now >= expiry) || (budgetStop && parkedChild)) {
			// Expiry outranks an existing park: budget/expiry text stays, but a
			// parked child keeps needs_human because its decision is pending.
			if (parkedChild) {
				record.batch_state = "needs_human";
				persist();
				parked = true;
				break;
			}
		}
		if (!Number.isNaN(expiry) && now >= expiry) {
			record.batch_state = "budget_stopped";
			persist();
			break;
		}
		if (budgetStop) {
			record.batch_state = "budget_stopped";
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
		let adoptedClaim = false;
		try {
			const fresh = await input.kernel.projectTask(input.root, child.task_id);
			if (
				fresh.error === null &&
				fresh.claim !== null &&
				fresh.claim.task_id === child.task_id &&
				fresh.claim.batch_id === input.batch_id
			) {
				adoptedClaim = true;
			}
		} catch {
			// Read-only projection failure: fall through to enrollTask, which
			// surfaces any real claim conflict as its own error.
		}
		if (adoptedClaim) {
			record.children = record.children.map((c) =>
				c.task_id === child.task_id
					? { ...c, state: "enrolled", reason: "adopted existing batch claim after interruption" }
					: c,
			);
			persist();
		} else {
		try {
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
			// review-5(2nd round): only an expiry (typed or reported by the
			// host) is an intentional budget stop; capability/binding/mismatch
			// failures surface as needs_human.
			const expired =
				isAuthorizationExpiryError(error) || /authoriz[^]*expir|expir[^]*authoriz/i.test(message);
			if (expired) {
				record.children = record.children.map((c) =>
					c.task_id === child.task_id ? { ...c, state: "pending", reason: message } : c,
				);
				record.batch_state = "budget_stopped";
				persist();
				break;
			}
			record.children = record.children.map((c) =>
				c.task_id === child.task_id ? { ...c, state: "needs_human", reason: message } : c,
			);
			parked = true;
			skipDependents(record, child.task_id, `dependency ${child.task_id} parked`);
			persist();
			continue;
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
				const { commit } = await input.kernel.commitChild(
					input.root,
					child.task_id,
					input.batch_id,
					head,
				);
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
			parked = true;
			skipDependents(record, child.task_id, `dependency ${child.task_id} parked`);
			persist();
		} else if (terminal.state === "rework") {
			record.consecutive_qa_failures += 1;
			if (record.consecutive_qa_failures >= record.budget.qa_failure_limit) {
				record.children = record.children.map((c) =>
					c.task_id === child.task_id
						? { ...c, state: "needs_human", reason: `QA failure limit reached: ${terminal.summary}` }
						: c,
				);
				record.batch_state = "needs_human";
				childTerminal = true;
				parked = true;
				skipDependents(record, child.task_id, `dependency ${child.task_id} parked`);
				persist();
			} else {
				// Below the limit: the inner loop re-drives the same child.
				persist();
			}
		} else if (terminal.state === "failed" || terminal.state === "blocked") {
			const reason = terminal.reason;
			const userOwned =
				/resolve_user_decision|revise_intent|resolve_finding|request_authorization|review rework limit|durable replan/i.test(
					reason,
				);
			childTerminal = true;
			record.children = record.children.map((c) =>
				c.task_id === child.task_id
					? { ...c, state: userOwned ? "needs_human" : "needs_human", reason }
					: c,
			);
			parked = true;
			skipDependents(record, child.task_id, `dependency ${child.task_id} parked`);
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

	if (parked && record.batch_state === "running") {
		record.batch_state = "needs_human";
		persist();
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
		case "failed":
			return "a commit or lineage failure stopped the batch";
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
	if (isTerminalBatchState(existing.batch_state))
		return replayTerminal(input.root, existing);

	// An enrolled-but-unsettled child must reach its own Kernel terminal
	// settlement before anything else, even under an expired authorization:
	// its claim is already held and the Kernel owns its remaining obligations.
	// review-1(2nd round): an `enrolled` child is verified against a fresh
	// Kernel projection; a projection that finds no active claim means the
	// persisted `enrolled` flag predates a successful enrollment, so the child
	// returns to pending instead of being driven without a claim.
	const interrupted = existing.children.find(
		(child) => child.state === "enrolled" || child.state === "settled",
	);
	// review-2(5th): a crash between durable enrollTask and the
	// enrolled-persist leaves the child persisted as pending while the Kernel
	// claim is already open. Re-marking it pending would let the main loop
	// re-enroll (double-claim). Adopt it as enrolled when the fresh projection
	// shows this batch's claim on that task.
	if (!interrupted) {
		for (const pending of existing.children.filter((c) => c.state === "pending")) {
			try {
				const fresh = await input.kernel.projectTask(input.root, pending.task_id);
				const holds =
					fresh.error === null &&
					fresh.claim !== null &&
					fresh.claim.task_id === pending.task_id;
				if (holds) {
					existing = writeBatchRunState(input.root, {
						...existing,
						children: existing.children.map((c) =>
							c.task_id === pending.task_id
								? {
										...c,
										state: "enrolled",
										reason: "adopted existing batch claim after interruption",
									}
								: c,
						),
					});
					break;
				}
			} catch {
				// Read-only projection failure: leave the child pending; the
				// main loop's enrollTask surfaces any real claim conflict.
			}
		}
	}
	// review-2(5th): recompute after possible adoption so an adopted child is
	// driven as interrupted instead of falling to the expiry gate.
	const driven = existing.children.find(
		(child) => child.state === "enrolled" || child.state === "settled",
	);
	if (driven) {
		if (driven.state === "enrolled") {
			const fresh = await input.kernel.projectTask(input.root, driven.task_id);
			const holdsClaim =
				fresh.error === null &&
				fresh.claim !== null &&
				fresh.claim.task_id === driven.task_id;
			if (!holdsClaim) {
				// review-1(4th round): a claimless projection still carries a
				// projection body when the task is a terminal owner. If the fresh
				// projection shows the child already reached its Kernel terminal
				// settlement (lifecycle done), the persisted `enrolled` flag
				// predates a crash between advanceTask and state persistence:
				// settle the child here so resume continues at the commit
				// obligation instead of re-enrolling completed work.
				const settledRemotely =
					fresh.error === null &&
					fresh.projection?.lifecycle === "done" &&
					fresh.projection?.completion_ready === true;
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

	const expiry = Date.parse(existing.authorization_expires_at);
	if (!Number.isNaN(expiry) && Date.now() >= expiry) {
		// review-2(4th round): expiry of a still-running batch is a terminal
		// budget_stopped transition, not an in-place report: persist the state,
		// then write the single terminal run report. A completed child is never
		// marked failed by this stop.
		const stopped: BatchRunStateRecord = { ...existing, batch_state: "budget_stopped" };
		const persisted = writeBatchRunState(input.root, stopped);
		return finalize(
			input.root,
			persisted,
			"authorization expired; resume requires a new literal-user confirmation",
			"The authorization expired; a human decision is required: re-confirm the batch to continue.",
		);
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
			try {
				existing = await input.kernel.lookupBatchCommit(
					input.root,
					child.task_id,
					input.batch_id,
				);
			} catch {
				// Lookup failure: fall through to commitChild, which surfaces
				// the real conflict as its own error.
			}
			const adopted =
				existing ??
				(await input.kernel
					.commitChild(input.root, child.task_id, input.batch_id, head)
					.catch((error: unknown) => {
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
				const { commit } = await input.kernel.commitChild(
					input.root,
					child.task_id,
					input.batch_id,
					head,
				);
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
			// A foreground Review reservation stays with the calling host turn.
			return reportFor(
				record,
				`child ${child.task_id} holds an open Review reservation`,
				"Submit the reserved foreground Review verdict, then call startBatch again to continue.",
			);
		} else if (terminal.state === "rework") {
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
