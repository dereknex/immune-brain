/**
 * Loop Daemon: abandon lands as a batch discard (ULS Spec D4.1-D4.2).
 *
 * `applySteeringRequests` only moves an item to `abandoned`. Every tick then
 * calls this for each abandoned WorkItem whose batch is not yet terminal: the
 * batch is torn down through `lane_sessions/discardLanes` (gated stop,
 * `closeWithProof`, per-child Lane removal, `imm/<slug>` deletion once every Lane
 * is gone) until its record is `discarded`. A retained resource keeps the record
 * `discarding` with a named `batch_lane_retained` condition and is retried on the
 * next tick; resources already removed are never revisited. Host
 * `retire_stale_batch` is a separate, unchanged path.
 */
import { discardLanes, type DiscardLanesDeps } from "../lane_sessions/index.ts";
import { findActiveLaneBatchForTask } from "../unattended/batch_preflight.ts";
import { isLaneBatchRecord, isTerminalBatchState, readAnyBatchRunState } from "../unattended/batch_state.ts";
import { listWorkItems, type WorkItem } from "./work_items.ts";

export interface DiscardTickEntry {
	target: string;
	batch_id: string;
	batch_state: "discarding" | "discarded";
	removed: string[];
	retained: Array<{ task_id: string; condition: string; reason: string }>;
}

export interface DiscardTickInput {
	root: string;
	stateDir: string;
	now: string;
	host: DiscardLanesDeps["host"];
	env?: Record<string, string | undefined>;
	createPort?: DiscardLanesDeps["createPort"];
	providerRegistry?: DiscardLanesDeps["providerRegistry"];
}

/** The batch an abandoned item owns: its recorded id, else the active batch found through its tasks. */
function batchOf(root: string, item: WorkItem): string | null {
	if (item.binding.batch_id) return item.binding.batch_id;
	for (const taskId of [item.binding.initiative_slug, ...item.binding.task_ids]) {
		if (!taskId) continue;
		try {
			const active = findActiveLaneBatchForTask(root, taskId);
			if (active) return active.record.batch_id;
		} catch {
			// An unreadable or ambiguous match is not discarded on a guess.
		}
	}
	return null;
}

export async function discardAbandonedBatches(input: DiscardTickInput): Promise<DiscardTickEntry[]> {
	const entries: DiscardTickEntry[] = [];
	for (const item of listWorkItems(input.stateDir)) {
		if (item.state !== "abandoned") continue;
		const batchId = batchOf(input.root, item);
		if (!batchId) continue;
		let record;
		try {
			record = readAnyBatchRunState(input.root, batchId);
		} catch {
			continue;
		}
		// A terminal record (discarded, completed, retired) is never touched again.
		if (!record || !isLaneBatchRecord(record) || isTerminalBatchState(record.batch_state)) continue;
		const result = await discardLanes(input.root, batchId, {
			env: input.env ?? ({ ...process.env } as Record<string, string | undefined>),
			host: input.host,
			now: input.now,
			...(input.createPort ? { createPort: input.createPort } : {}),
			...(input.providerRegistry ? { providerRegistry: input.providerRegistry } : {}),
		});
		if ("ok" in result) continue;
		entries.push({
			target: item.target,
			batch_id: batchId,
			batch_state: result.batch_state,
			removed: result.removed,
			retained: result.retained.map(({ task_id, condition, reason }) => ({ task_id, condition, reason })),
		});
	}
	return entries;
}
