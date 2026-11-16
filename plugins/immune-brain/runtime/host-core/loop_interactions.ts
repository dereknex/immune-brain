/**
 * Loop Interaction Host tools (S4, D4)
 *
 * Implements D4 of docs/specs/loop-agent-scheduling.spec.md: `loop_interactions`
 * (non-privileged) lists the requests the daemon wrote under
 * `.imm/state/loop/interactions/`, and `answer_loop_interaction` (privileged)
 * records one answer under its native confirmation. Both Hosts call these, so
 * neither adapter restates what a pending request is.
 *
 * Interface: `LOOP_INTERACTIONS_TOOL`, `ANSWER_LOOP_INTERACTION_TOOL`,
 * `listPendingLoopInteractions`, `answerableLoopInteraction`, `LocalAnswerPort`.
 * Invariants: a `plan_approval` is answered by the user's own `drive` entry and a
 * `notice` is never answered; only the shared runtime writes an answer, and only
 * through its native gate.
 * Side Effects: none here; the runtime writes the answer file.
 * Verification: `bun test tests/loop-sched-interaction-local.test.ts`.
 */

import {
	readLocalAnswer,
	readLocalRequests,
	loopInteractionStateDir,
	type LocalInteractionRecord,
} from "../loop_daemon/interaction/local_channel.ts";
import { ANSWER_LOOP_INTERACTION_TOOL } from "../loop_daemon/interaction/local_channel.ts";

export { ANSWER_LOOP_INTERACTION_TOOL };

export const LOOP_INTERACTIONS_TOOL = "loop_interactions";
export const LOOP_INTERACTIONS_CONTRACT = "immune_brain/loop_interactions/v1";

/** One pending request as a Host session sees it. */
export interface LoopInteractionView {
	interaction_id: string;
	kind: LocalInteractionRecord["kind"];
	authority: LocalInteractionRecord["authority"];
	subject: LocalInteractionRecord["subject"];
	binding: LocalInteractionRecord["binding"];
	prompt: string;
	options?: string[];
	/** The answer form the request asked for. */
	answer: LocalInteractionRecord["answer"];
	/** Whether `answer_loop_interaction` may answer this request at all. */
	answerable: boolean;
	/** Present when only the user's own action answers it (D4: `plan_approval` → `drive`). */
	local_action?: string;
	/** The confirmed answer is on disk and the daemon applies it on its next tick. */
	answered: boolean;
}

/** D4: `plan_approval` is answered by the user's own `drive` entry, and a notice by nothing. */
export function answerableLoopInteraction(request: Pick<LocalInteractionRecord, "kind">): boolean {
	return request.kind !== "plan_approval" && request.kind !== "notice";
}

const LOCAL_ACTION: Partial<Record<LocalInteractionRecord["kind"], string>> = {
	plan_approval: "answer it by running `drive` on the published TaskIntent in your own Host session",
	notice: "act on the notice in your own Host session",
};

/**
 * The requests this checkout's daemon is waiting on. `taskId` narrows the list
 * to one Task when the caller names it; nothing else is filtered, so a request
 * the caller cannot answer stays visible with its `local_action`.
 */
export function listPendingLoopInteractions(root: string, taskId?: string) {
	const stateDir = loopInteractionStateDir(root);
	const pending = readLocalRequests(stateDir)
		.filter((request) => !taskId || request.subject.task_id === taskId)
		.map((request): LoopInteractionView => {
			const answerable = answerableLoopInteraction(request);
			const answer = readLocalAnswer(stateDir, request.interaction_id);
			return {
				interaction_id: request.interaction_id,
				kind: request.kind,
				authority: request.authority,
				subject: request.subject,
				binding: request.binding,
				prompt: request.prompt,
				...(request.options && request.options.length > 0 ? { options: [...request.options] } : {}),
				answer: request.answer,
				answerable,
				...(answerable ? {} : { local_action: LOCAL_ACTION[request.kind] ?? "" }),
				answered: answer !== null,
			};
		});
	return { contract: LOOP_INTERACTIONS_CONTRACT, state_dir: stateDir, pending, pending_count: pending.length };
}
