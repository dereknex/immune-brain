/**
 * Loop Daemon: Owner Steering (S5)
 *
 * Implements D5.2 of docs/specs/loop-leader.spec.md (BR-REQ-6). A privileged
 * Host tool writes one request per natively confirmed `pause`/`resume`/`abandon`
 * under `.imm/state/loop/steering/`; the daemon applies it on its next tick and
 * removes the file, so a steering action is applied exactly once. `abandon`
 * moves the item to the terminal `abandoned` state and never touches a running
 * Kernel run.
 */

import { createHash, randomUUID } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readWorkItem, writeWorkItem } from "./work_items.ts";

export const STEER_LOOP_WORK_ITEM_TOOL = "steer_loop_work_item";
export const LOOP_STEERING_REQUEST_CONTRACT = "assurance_kernel/loop_steering_request/v1" as const;
export const LOOP_STEERING_ACTIONS = ["pause", "resume", "abandon"] as const;

export type LoopSteeringAction = (typeof LOOP_STEERING_ACTIONS)[number];

export interface LoopSteeringRequest {
	contract: typeof LOOP_STEERING_REQUEST_CONTRACT;
	target: string;
	action: LoopSteeringAction;
	reason: string | null;
	requested_at: string;
	confirmation: { tool: string; confirmed_at: string; confirmation_ref: string };
}

export interface SteeringApplication {
	applied: Array<{ target: string; action: LoopSteeringAction; state: string; paused: boolean }>;
	refused: Array<{ target: string; action: LoopSteeringAction; reason: string }>;
}

export function isLoopSteeringAction(value: unknown): value is LoopSteeringAction {
	return typeof value === "string" && (LOOP_STEERING_ACTIONS as readonly string[]).includes(value);
}

/** The request directory inside a daemon state directory. */
export function steeringDir(stateDir: string): string {
	return join(stateDir, "steering");
}

/** The steering digests the native confirmation binds: one target, one action. */
export function steeringBindingDigest(target: string, action: string, reason: string | null): string {
	return `sha256:${createHash("sha256").update(`${target}\0${action}\0${reason ?? ""}`).digest("hex")}`;
}

/** Write one confirmed request; the daemon applies and removes it on its next tick. */
export function writeSteeringRequest(stateDir: string, request: LoopSteeringRequest): string {
	const dir = steeringDir(stateDir);
	mkdirSync(dir, { recursive: true, mode: 0o700 });
	try {
		chmodSync(dir, 0o700);
	} catch {}
	const path = join(dir, `${randomUUID()}.json`);
	writeFileSync(path, `${JSON.stringify(request, null, 2)}\n`, { mode: 0o600 });
	try {
		chmodSync(path, 0o600);
	} catch {}
	return path;
}

/** Every readable request, oldest file first; a torn file is kept as `null` and dropped with it. */
export function listSteeringRequests(stateDir: string): Array<{ path: string; request: LoopSteeringRequest | null }> {
	const dir = steeringDir(stateDir);
	if (!existsSync(dir)) return [];
	const requests: Array<{ path: string; request: LoopSteeringRequest | null }> = [];
	for (const file of readdirSync(dir).sort()) {
		if (!file.endsWith(".json")) continue;
		const path = join(dir, file);
		try {
			const parsed = JSON.parse(readFileSync(path, "utf8")) as LoopSteeringRequest;
			if (parsed?.contract !== LOOP_STEERING_REQUEST_CONTRACT) continue;
			if (typeof parsed.target !== "string" || !isLoopSteeringAction(parsed.action)) continue;
			requests.push({ path, request: parsed });
		} catch {
			// A torn request is dropped with its file rather than applied.
			requests.push({ path, request: null });
		}
	}
	return requests;
}

/**
 * Apply every pending request once and delete it. `pause` sets `paused`,
 * `resume` clears it, `abandon` reaches the terminal `abandoned` state from any
 * non-terminal state; nothing here starts, stops or edits a Kernel run.
 */
export function applySteeringRequests(stateDir: string, now: string): SteeringApplication {
	const result: SteeringApplication = { applied: [], refused: [] };
	for (const { path, request } of listSteeringRequests(stateDir)) {
		if (request === null) {
			rmSync(path, { force: true });
			continue;
		}
		const item = readWorkItem(stateDir, request.target);
		if (!item) {
			result.refused.push({ target: request.target, action: request.action, reason: "work_item_unknown" });
			rmSync(path, { force: true });
			continue;
		}
		if (request.action === "abandon") {
			if (item.state === "abandoned") {
				result.applied.push({ target: item.target, action: request.action, state: item.state, paused: item.paused === true });
			} else if (item.state === "closed") {
				result.refused.push({ target: request.target, action: request.action, reason: "work_item_closed" });
			} else {
				const abandoned = { ...item, state: "abandoned" as const, revision: item.revision + 1, updated_at: now };
				writeWorkItem(stateDir, abandoned);
				result.applied.push({ target: item.target, action: request.action, state: abandoned.state, paused: abandoned.paused === true });
			}
			rmSync(path, { force: true });
			continue;
		}
		const paused = request.action === "pause";
		const next = { ...item, paused, revision: item.revision + 1, updated_at: now };
		writeWorkItem(stateDir, next);
		result.applied.push({ target: item.target, action: request.action, state: next.state, paused });
		rmSync(path, { force: true });
	}
	return result;
}
