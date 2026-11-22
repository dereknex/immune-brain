/**
 * Loop Daemon: Catalog Role Session Registry (S3)
 *
 * Implements D3.5 of docs/specs/loop-leader.spec.md: a leader `dispatch` starts
 * one catalog role session, and `imm-loop status --json` lists the ones still
 * running with their target, role, base and start time. The record is also the
 * completion evidence: a session counts as done only from its own record, never
 * from what it printed (ADR 0039 Decision 2).
 *
 * One file per session under `.imm/state/loop/role_sessions/`, mode `0600`. The
 * registry is rebuildable orchestration state and never authority: losing it
 * costs one listing, not an approval.
 */

import { randomUUID } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { LoopRoleBase } from "./role_catalog.ts";

export const LOOP_ROLE_SESSION_CONTRACT = "assurance_kernel/loop_role_session/v1" as const;

export type LoopRoleSessionStatus = "running" | "completed" | "failed";

export interface LoopRoleSession {
	contract: typeof LOOP_ROLE_SESSION_CONTRACT;
	session_id: string;
	/** The WorkItem target the session was dispatched for. */
	target: string;
	role: string;
	base: LoopRoleBase;
	started_at: string;
	finished_at: string | null;
	status: LoopRoleSessionStatus;
	/** The session record's own reason; a completed session names its evidence. */
	reason: string;
}

export function roleSessionsDir(stateDir: string): string {
	return join(stateDir, "role_sessions");
}

function sessionPath(stateDir: string, sessionId: string): string {
	return join(roleSessionsDir(stateDir), `${sessionId}.json`);
}

export function listRoleSessions(stateDir: string): LoopRoleSession[] {
	const directory = roleSessionsDir(stateDir);
	if (!existsSync(directory)) return [];
	const sessions: LoopRoleSession[] = [];
	for (const file of readdirSync(directory).sort()) {
		if (!file.endsWith(".json")) continue;
		try {
			const parsed = JSON.parse(readFileSync(join(directory, file), "utf8")) as LoopRoleSession;
			if (parsed?.contract !== LOOP_ROLE_SESSION_CONTRACT) continue;
			if (typeof parsed.session_id !== "string" || typeof parsed.target !== "string") continue;
			sessions.push(parsed);
		} catch {}
	}
	return sessions;
}

/** The sessions still running: what `status --json` lists and `max_parallel` counts. */
export function runningRoleSessions(stateDir: string): LoopRoleSession[] {
	return listRoleSessions(stateDir).filter((session) => session.status === "running");
}

export function writeRoleSession(stateDir: string, session: LoopRoleSession): void {
	const directory = roleSessionsDir(stateDir);
	mkdirSync(directory, { recursive: true, mode: 0o700 });
	const path = sessionPath(stateDir, session.session_id);
	const temp = `${path}.${randomUUID()}.tmp`;
	writeFileSync(temp, `${JSON.stringify(session, null, 2)}\n`, { mode: 0o600 });
	try {
		chmodSync(temp, 0o600);
	} catch {}
	renameSync(temp, path);
	try {
		chmodSync(path, 0o600);
	} catch {}
}

/** Record one session as running before it starts, so a long session is listable. */
export function startRoleSession(
	stateDir: string,
	input: { target: string; role: string; base: LoopRoleBase; started_at: string },
): LoopRoleSession {
	const session: LoopRoleSession = {
		contract: LOOP_ROLE_SESSION_CONTRACT,
		session_id: `role-${randomUUID()}`,
		target: input.target,
		role: input.role,
		base: input.base,
		started_at: input.started_at,
		finished_at: null,
		status: "running",
		reason: "running",
	};
	writeRoleSession(stateDir, session);
	return session;
}

/**
 * Reap sessions a dead tick left behind. Every dispatch awaits its session
 * inside the same tick, so a record still `running` when a new tick starts has
 * no live owner: leaving it would list a phantom session forever and hold its
 * role at `max_parallel` indefinitely. Reaped records fail closed with the
 * interruption named, and the role is dispatchable again on this tick.
 */
export function reapOrphanedRoleSessions(
	stateDir: string,
	input: { at: string; reason?: string },
): LoopRoleSession[] {
	const reaped: LoopRoleSession[] = [];
	for (const session of runningRoleSessions(stateDir)) {
		reaped.push(
			finishRoleSession(stateDir, session, {
				status: "failed",
				reason: input.reason ?? `tick_interrupted: the tick that started ${session.session_id} never closed it`,
				at: input.at,
			}),
		);
	}
	return reaped;
}

/** Close one session from its own record: `completed` carries the evidence reason. */
export function finishRoleSession(
	stateDir: string,
	session: LoopRoleSession,
	input: { status: Exclude<LoopRoleSessionStatus, "running">; reason: string; at: string },
): LoopRoleSession {
	const finished: LoopRoleSession = {
		...session,
		status: input.status,
		reason: input.reason,
		finished_at: input.at,
	};
	writeRoleSession(stateDir, finished);
	return finished;
}
