// Spec drive-always-lanes D11, D8 (S5): a single-task Lane Executor stops on a
// literal-user decision, the Parent's own Host answers it through its native gate,
// and the runtime applies the answer to the Lane store and starts the next
// Executor generation. This module never opens a gate: the Host passes the
// operation that does, and the literal user remains the only decider.

import type { AssuranceProjectionResult } from "../kernel/assurance_projection";
import { readTaskRecordRaw } from "../kernel/storage";
import { findExistingActiveBatch } from "./batch_preflight";
import { batchReason } from "./batch_reasons";
import { isLaneBatchRecord, laneGenerationStore, parkLaneForExecutor, rebindSingleTaskIdentity } from "./batch_state";
import { LaneSupervisor, superviseLane, type ExecutorHost } from "./lane_supervisor";
import { laneExecutorChoice, stopSingleTaskSupervisor } from "./batch_runner";
import { clearLaneDecisionRequest, readLaneDecisionRequest } from "./lane_decision_request";

type Projection = AssuranceProjectionResult["projection"];

/** What the Lane record is waiting on, as the Kernel projection states it. */
export interface LaneDecisionFacts {
	task_id: string;
	run_id: string | null;
	record_revision: string;
	authorization: Projection["authorization"];
	open_user_decision_count: number;
	replan_required_ids: string[];
	/** #426 F19: the breaking revision a headless Executor asked for; the Parent passes `next_intent` to its gate. */
	requested?: { operation: "approve_breaking_intent_revision"; next_intent: unknown };
}

export type LaneDecisionOperation = "request_authorization" | "approve_breaking_intent_revision" | "stop";

/**
 * The decision facts of an active Lane record, or null when it waits on no literal-user decision. With
 * `lanePath`, a headless Executor's request that still binds the current record also counts (#426 F19).
 */
export function laneDecisionFacts(taskId: string, projection: Projection, lanePath?: string): LaneDecisionFacts | null {
	if (projection.lifecycle !== "active") return null;
	const request = lanePath ? readLaneDecisionRequest(lanePath, taskId, projection.record_revision) : null;
	const waiting = projection.next_obligation === "resolve_user_decision" || projection.next_obligation === "revise_intent" || projection.open_user_decision_count > 0 ||
		projection.replan_required_ids.length > 0 || projection.authorization.state !== "none" || request !== null;
	if (!waiting) return null;
	return { task_id: taskId, run_id: projection.run_id, record_revision: projection.record_revision, authorization: projection.authorization,
		open_user_decision_count: projection.open_user_decision_count, replan_required_ids: [...projection.replan_required_ids],
		...(request ? { requested: { operation: request.operation, next_intent: request.next_intent } } : {}) };
}

/**
 * Returns whether the decision facts represent a user_only gate (D7).
 * All literal-user decisions in laneDecisionFacts are user_only gates.
 */
export function isUserOnlyDecision(facts: LaneDecisionFacts | null): boolean {
	if (!facts) return false;
	return (
		facts.authorization.state !== "none" ||
		facts.open_user_decision_count > 0 ||
		facts.replan_required_ids.length > 0 ||
		facts.requested !== undefined
	);
}

export interface LaneRelayTarget {
	batch_id: string;
	task_id: string;
	lane_path: string;
}

/**
 * The Lane a decision for `taskId` is relayed to: the child of an active
 * single-task batch whose slug is the task. A task that is a child of an
 * Initiative batch never matches, so its behavior stays as it was (E6).
 */
export function findLaneRelayTarget(root: string, taskId: string): LaneRelayTarget | null {
	const found = findExistingActiveBatch(root, taskId);
	if (!found || found.corrupt || !isLaneBatchRecord(found.record) || found.record.plan_source !== "single_task") return null;
	const child = found.record.children.find(value => value.task_id === taskId);
	if (!child?.lane || (child.state !== "enrolled" && child.state !== "needs_human")) return null;
	return { batch_id: found.record.batch_id, task_id: taskId, lane_path: child.lane.path };
}

export class LaneDecisionStaleError extends Error {
	readonly reason = "lane_decision_stale";
	constructor(detail: string) { super(`${batchReason("lane_decision_stale").reason}: ${detail}`); }
}

export interface LaneRelayInput<R> {
	root: string;
	taskId: string;
	operation: LaneDecisionOperation;
	/** The record revision the caller read in `lane_decision_required`; a different current one is stale. */
	expectedRecordRevision?: string;
	project: (lanePath: string, taskId: string) => Promise<AssuranceProjectionResult>;
	/** Opens the Host's native gate and applies the Kernel operation in the Lane root. Nothing else may write the Lane. */
	apply: (target: LaneRelayTarget, facts: LaneDecisionFacts | null) => Promise<R>;
	/** Whether `apply` committed the operation. A Host that reports a cancelled or blocked gate by value returns false; default true. */
	applied?: (result: R) => boolean;
	supervisor: LaneSupervisor;
	parentHost: ExecutorHost;
	pluginDir: string;
	waitMs: number;
	signal?: AbortSignal;
}

export type LaneRelayOutcome<R> =
	| { relayed: false }
	| { relayed: true; result: R; lane_relay: { batch_id: string; operation: LaneDecisionOperation; applied: boolean; rebound: boolean; lane_supervision: unknown; lane_refusals?: unknown; next_action?: string } };

async function readFacts(input: Pick<LaneRelayInput<unknown>, "project">, target: LaneRelayTarget) {
	const read = await input.project(target.lane_path, target.task_id);
	if (read.error !== null) throw new Error(`batch_lane_unreadable: ${read.error}`);
	return laneDecisionFacts(target.task_id, read.projection, target.lane_path);
}

/** Relay one literal-user decision to the single-task Lane of `taskId`; `relayed: false` when no such Lane exists. */
export async function relayLaneDecision<R>(input: LaneRelayInput<R>): Promise<LaneRelayOutcome<R>> {
	const target = findLaneRelayTarget(input.root, input.taskId);
	if (!target) return { relayed: false };
	const before = await readFacts(input, target);
	if (input.operation !== "stop") {
		if (!before) throw new LaneDecisionStaleError("the Lane record waits on no decision");
		if (input.expectedRecordRevision && input.expectedRecordRevision !== before.record_revision)
			throw new LaneDecisionStaleError(`record revision ${input.expectedRecordRevision} is no longer current`);
	}
	let result: R;
	try {
		result = await input.apply(target, before);
	} catch (error) {
		// A refused or cancelled gate applied nothing; a record that moved while it was open is stale.
		if (before) {
			const after = await readFacts(input, target).catch(() => before);
			if (after?.record_revision !== before.record_revision) throw new LaneDecisionStaleError("the Lane record changed while the gate was open");
		}
		throw error;
	}
	if (input.applied && !input.applied(result))
		return { relayed: true, result, lane_relay: { batch_id: target.batch_id, operation: input.operation, applied: false, rebound: false, lane_supervision: null } };
	// The request was answered: the committed decision (or stop) moved the Lane record past it.
	clearLaneDecisionRequest(target.lane_path);
	const batch = findExistingActiveBatch(input.root, input.taskId);
	const interactive = batch && !batch.corrupt && isLaneBatchRecord(batch.record) && batch.record.executor_mode === "interactive";
	if (input.operation === "stop") {
		if (interactive) {
			parkLaneForExecutor(input.root, target.batch_id, input.taskId, "lane_executor_stopped");
			return { relayed: true, result, lane_relay: { batch_id: target.batch_id, operation: input.operation, applied: true, rebound: false,
				lane_supervision: null, next_action: "The Lane task is stopped. Close its Herdr Executor tab yourself; the Lane and branches are retained." } };
		}
		// The Kernel stop of the Lane record was just applied under the user's gate; the
		// generation is then terminated and the Lane kept (parked by the supervisor stop).
		const stopped = await stopSingleTaskSupervisor(input.supervisor, input.root, input.taskId, input.signal);
		const report = stopped.state === "started" ? stopped.report as unknown as { lane_supervision?: unknown; lane_refusals?: unknown } : {};
		return { relayed: true, result, lane_relay: { batch_id: target.batch_id, operation: input.operation, applied: true, rebound: false,
			lane_supervision: report.lane_supervision ?? null, ...(report.lane_refusals ? { lane_refusals: report.lane_refusals } : {}) } };
	}
	let rebound = false;
	if (input.operation === "approve_breaking_intent_revision") {
		try {
			// The Kernel-committed revision in the Lane record is the only source of the new identity.
			const committed = readTaskRecordRaw(target.lane_path, input.taskId).record;
			if (!committed) throw new Error("the Lane TaskRecord is unreadable");
			rebindSingleTaskIdentity(input.root, target.batch_id, { task_id: input.taskId, intent: committed.intent_snapshot, content_hash: committed.intent_ref.content_hash });
			rebound = true;
		} catch (error) {
			throw new Error(`${batchReason("lane_decision_rebind_failed").reason}: ${error instanceof Error ? error.message : String(error)}`);
		}
	}
	if (interactive)
		return { relayed: true, result, lane_relay: { batch_id: target.batch_id, operation: input.operation, applied: true, rebound, lane_supervision: null } };
	const choice = laneExecutorChoice(input.root, batch && !batch.corrupt && isLaneBatchRecord(batch.record) ? batch.record.executor_preferences : undefined, input.parentHost);
	if (!choice) return { relayed: true, result, lane_relay: { batch_id: target.batch_id, operation: input.operation, applied: true, rebound, lane_supervision: null } };
	const observation = await superviseLane(input.supervisor, {
		key: `${input.root}\0${target.batch_id}`, repository: input.root, lanePath: target.lane_path, taskId: input.taskId,
		choice, pluginDir: input.pluginDir, store: laneGenerationStore(input.root, target.batch_id), baseline: "",
		waitMs: input.waitMs, graceMs: 1000, signal: input.signal,
		project: async () => {
			const read = await input.project(target.lane_path, target.task_id);
			if (read.error !== null) throw new Error(`batch_lane_unreadable: ${read.error}`);
			return read.projection;
		},
	});
	return { relayed: true, result, lane_relay: { batch_id: target.batch_id, operation: input.operation, applied: true, rebound,
		lane_supervision: { ...observation, not_applied: choice.not_applied } } };
}
