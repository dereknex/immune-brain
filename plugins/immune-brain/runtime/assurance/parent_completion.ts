// Parent Completion
//
// Owner: Assurance — whether every required Task of an Initiative Parent has
// settled delivery evidence.
// Interface: `observeSettledParentCompletion`.
// Side Effects: none; reads `.imm/audit/` evidence and TaskIntents.
// Verification: `bun test tests/github-initiative-recovery.test.ts`.

import { readTaskIntent } from "../kernel/intent";
import { readSettledTaskEvidence } from "../kernel/storage";

export interface SettledParentCompletion {
	complete: boolean;
	/** Settled `done` with an unchanged TaskIntent. */
	delivered_task_ids: string[];
	missing_task_ids: string[];
	reason: string | null;
}

function isDelivered(root: string, taskId: string): boolean {
	const settled = readSettledTaskEvidence(root, taskId);
	if (!settled || settled.proof.terminal_lifecycle !== "done") return false;
	return readTaskIntent(root, taskId, settled.record.intent_ref.path).content_hash === settled.record.intent_ref.content_hash;
}

/** Remote closure is an observation; only local settled evidence proves delivery. */
export function observeSettledParentCompletion(root: string, requiredTaskIds: readonly string[]): SettledParentCompletion {
	if (!requiredTaskIds.length || new Set(requiredTaskIds).size !== requiredTaskIds.length)
		throw new Error("Parent completion requires a non-empty, unique required Task list");
	const delivered = requiredTaskIds.filter((taskId) => isDelivered(root, taskId));
	const missing = requiredTaskIds.filter((taskId) => !delivered.includes(taskId));
	return {
		complete: missing.length === 0,
		delivered_task_ids: delivered,
		missing_task_ids: missing,
		reason: missing.length ? `Required delivery is absent: ${missing.join(", ")}` : null,
	};
}
