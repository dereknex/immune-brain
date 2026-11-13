// #426 F19: a supervised headless Lane Executor (`--print`) has no native gate:
// its breaking-revision call is cancelled by the Host and the Kernel records
// nothing, so the Parent never sees a decision to relay. The Executor's runtime
// instead leaves this request in the Lane; it grants nothing. The Parent shows it
// in `lane_decision_required` and the literal user answers at the Parent's gate.

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/** Set by the Lane supervisor on every headless Executor generation it spawns. */
export const LANE_EXECUTOR_ENV = "IMM_LANE_EXECUTOR";
export const LANE_EXECUTOR_HEADLESS = "headless";

export interface LaneDecisionRequest {
	contract: "assurance_kernel/lane_decision_request/v1";
	task_id: string;
	operation: "approve_breaking_intent_revision";
	/** The Lane record revision the Executor read; any later write makes the request stale. */
	record_revision: string;
	next_intent: unknown;
	requested_at: string;
}

export function laneDecisionRequestPath(lanePath: string): string {
	return join(lanePath, ".imm", "state", "lane-decision-request.json");
}

export function writeLaneDecisionRequest(lanePath: string, request: Omit<LaneDecisionRequest, "contract">): LaneDecisionRequest {
	const value: LaneDecisionRequest = { contract: "assurance_kernel/lane_decision_request/v1", ...request };
	const path = laneDecisionRequestPath(lanePath);
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
	return value;
}

/** The request for `taskId` that still binds `recordRevision`; null when absent, unreadable or stale. */
export function readLaneDecisionRequest(lanePath: string, taskId: string, recordRevision: string): LaneDecisionRequest | null {
	const path = laneDecisionRequestPath(lanePath);
	if (!existsSync(path)) return null;
	try {
		const value = JSON.parse(readFileSync(path, "utf8")) as Partial<LaneDecisionRequest>;
		if (value.contract !== "assurance_kernel/lane_decision_request/v1" || value.task_id !== taskId ||
			value.operation !== "approve_breaking_intent_revision" || value.record_revision !== recordRevision ||
			!value.next_intent || typeof value.next_intent !== "object") return null;
		return value as LaneDecisionRequest;
	} catch {
		return null;
	}
}

export function clearLaneDecisionRequest(lanePath: string): void {
	rmSync(laneDecisionRequestPath(lanePath), { force: true });
}
