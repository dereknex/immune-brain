/**
 * Loop Daemon: Waiting Pointers (S4)
 *
 * Implements D4.6 of docs/specs/loop-leader.spec.md (BR-REQ-5, BR-OUT-3): the
 * daemon records one pointer per request it is waiting on, so `imm-loop status`
 * and the Status Issue can say *where* the owner is awaited without repeating
 * the question. The pointer is a projection, never state: losing it costs one
 * listing, never a transition.
 *
 * Interface: `recordWaitingPointer`, `clearWaitingPointer`, `listWaitingPointers`,
 * `listWaitingStatus`, `waitingTarget`.
 * Invariants: one file per `interaction_id`; a pointer carries no question text.
 * Side Effects: files under `<stateDir>/waiting/`.
 * Verification: `bun test tests/loop-leader-replan.test.ts`.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { InteractionKind, InteractionSubject } from "./interaction/protocol.ts";

export const WAITING_POINTER_CONTRACT = "immune_brain/loop_waiting_pointer/v1";

export interface WaitingPointer {
	contract: typeof WAITING_POINTER_CONTRACT;
	interaction_id: string;
	target: string;
	kind: InteractionKind;
	channel: "github" | "local";
	link: string;
	recorded_at: string;
}

/** D4.6: the target a subject is awaited on, in the WorkItem target shape. */
export function waitingTarget(subject: InteractionSubject): string | null {
	if (subject.issue !== undefined) return `issue-${subject.issue}`;
	if (subject.pr !== undefined) return `pr-${subject.pr}`;
	if (subject.task_id !== undefined) return `lane-${subject.task_id}`;
	return null;
}

function waitingDir(stateDir: string): string {
	return join(stateDir, "waiting");
}

function pointerPath(stateDir: string, interactionId: string): string {
	return join(waitingDir(stateDir), `${interactionId.replace(/[/\\]/g, "_")}.json`);
}

export function recordWaitingPointer(
	stateDir: string,
	pointer: Omit<WaitingPointer, "contract">,
): WaitingPointer {
	const value: WaitingPointer = { contract: WAITING_POINTER_CONTRACT, ...pointer };
	mkdirSync(waitingDir(stateDir), { recursive: true, mode: 0o700 });
	writeFileSync(pointerPath(stateDir, pointer.interaction_id), `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
	return value;
}

export function clearWaitingPointer(stateDir: string, interactionId: string): void {
	rmSync(pointerPath(stateDir, interactionId), { force: true });
}

/**
 * D4.6: one target waits on one question. Everything else recorded for it is a
 * superseded or retired request, so its pointer goes with it.
 */
export function clearWaitingPointersForTarget(stateDir: string, target: string, keepInteractionId?: string): void {
	for (const pointer of listWaitingPointers(stateDir)) {
		if (pointer.target !== target) continue;
		if (keepInteractionId !== undefined && pointer.interaction_id === keepInteractionId) continue;
		clearWaitingPointer(stateDir, pointer.interaction_id);
	}
}

export function listWaitingPointers(stateDir: string): WaitingPointer[] {
	const dir = waitingDir(stateDir);
	if (!existsSync(dir)) return [];
	const pointers: WaitingPointer[] = [];
	for (const entry of readdirSync(dir).sort()) {
		if (!entry.endsWith(".json")) continue;
		try {
			const parsed = JSON.parse(readFileSync(join(dir, entry), "utf8")) as WaitingPointer;
			if (parsed?.contract === WAITING_POINTER_CONTRACT && typeof parsed.interaction_id === "string") pointers.push(parsed);
		} catch {}
	}
	return pointers;
}

/** D4.6: the status projection — target, kind, channel and link, never the question. */
export function listWaitingStatus(stateDir: string): Array<{ target: string; kind: InteractionKind; channel: "github" | "local"; link: string }> {
	return listWaitingPointers(stateDir).map((pointer) => ({
		target: pointer.target,
		kind: pointer.kind,
		channel: pointer.channel,
		link: pointer.link,
	}));
}
