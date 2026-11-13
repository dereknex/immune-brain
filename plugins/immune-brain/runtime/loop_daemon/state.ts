/**
 * Loop Daemon: State and Leases Management (S1)
 *
 * Implements S1 and D2 of docs/specs/loop-daemon.spec.md.
 * Manages .imm/state/loop/state.json, events.jsonl, decisions.jsonl, and leases
 * with strict 0600 file permissions and 0700 directory permissions.
 */

import { appendFileSync, chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
	LOOP_DAEMON_LEASE_CONTRACT,
	LOOP_DAEMON_STATE_CONTRACT,
	type LoopDaemonState,
	type LoopLease,
	type NormalizedLoopEvent,
} from "./types.ts";

export function ensureLoopStateDir(stateDir: string): {
	stateDir: string;
	leasesDir: string;
	analysisDir: string;
} {
	mkdirSync(stateDir, { recursive: true, mode: 0o700 });
	try {
		chmodSync(stateDir, 0o700);
	} catch {}

	const leasesDir = join(stateDir, "leases");
	mkdirSync(leasesDir, { recursive: true, mode: 0o700 });
	try {
		chmodSync(leasesDir, 0o700);
	} catch {}

	const analysisDir = join(stateDir, "analysis");
	mkdirSync(analysisDir, { recursive: true, mode: 0o700 });
	try {
		chmodSync(analysisDir, 0o700);
	} catch {}

	return { stateDir, leasesDir, analysisDir };
}

export function initLoopState(): LoopDaemonState {
	return {
		contract: LOOP_DAEMON_STATE_CONTRACT,
		updated_at: new Date().toISOString(),
		watermarks: {
			issues_updated_at: null,
			comments_updated_at: null,
			prs_updated_at: null,
			etag_by_resource: {},
		},
		active_leases: {},
		paused: false,
		pause_reason: null,
		stats: {
			ticks_total: 0,
			events_observed_total: 0,
			last_tick_at: null,
		},
	};
}

export function loadLoopState(stateDir: string): LoopDaemonState | null {
	const statePath = join(stateDir, "state.json");
	if (!existsSync(statePath)) return null;

	try {
		const raw = readFileSync(statePath, "utf8");
		const parsed = JSON.parse(raw) as LoopDaemonState;
		if (parsed && parsed.contract === LOOP_DAEMON_STATE_CONTRACT && parsed.watermarks) {
			return parsed;
		}
	} catch {
		// Corrupt or invalid JSON
	}
	return null;
}

export function saveLoopState(stateDir: string, state: LoopDaemonState): void {
	ensureLoopStateDir(stateDir);
	const targetPath = join(stateDir, "state.json");
	const tempPath = join(stateDir, `state.${randomUUID()}.tmp`);

	const payload = `${JSON.stringify(state, null, 2)}\n`;
	writeFileSync(tempPath, payload, { mode: 0o600 });
	try {
		chmodSync(tempPath, 0o600);
	} catch {}

	renameSync(tempPath, targetPath);
	try {
		chmodSync(targetPath, 0o600);
	} catch {}
}

export function appendLoopEvent(stateDir: string, event: NormalizedLoopEvent): void {
	ensureLoopStateDir(stateDir);
	const eventsPath = join(stateDir, "events.jsonl");
	const line = `${JSON.stringify(event)}\n`;
	appendFileSync(eventsPath, line, { mode: 0o600 });
	try {
		chmodSync(eventsPath, 0o600);
	} catch {}
}

export function loadLoopEvents(stateDir: string): NormalizedLoopEvent[] {
	const eventsPath = join(stateDir, "events.jsonl");
	if (!existsSync(eventsPath)) return [];
	try {
		return readFileSync(eventsPath, "utf8")
			.trim()
			.split("\n")
			.filter(Boolean)
			.map((line) => JSON.parse(line) as NormalizedLoopEvent);
	} catch {
		return [];
	}
}

export function appendLoopDecision(stateDir: string, decision: unknown): void {
	ensureLoopStateDir(stateDir);
	const decisionsPath = join(stateDir, "decisions.jsonl");
	const line = `${JSON.stringify(decision)}\n`;
	appendFileSync(decisionsPath, line, { mode: 0o600 });
	try {
		chmodSync(decisionsPath, 0o600);
	} catch {}
}

export function loadLoopDecisions<T = any>(stateDir: string): T[] {
	const decisionsPath = join(stateDir, "decisions.jsonl");
	if (!existsSync(decisionsPath)) return [];
	try {
		return readFileSync(decisionsPath, "utf8")
			.trim()
			.split("\n")
			.filter(Boolean)
			.map((line) => JSON.parse(line) as T);
	} catch {
		return [];
	}
}

export function appendLoopDispatch(stateDir: string, dispatch: unknown): void {
	ensureLoopStateDir(stateDir);
	const dispatchesPath = join(stateDir, "dispatches.jsonl");
	const line = `${JSON.stringify(dispatch)}\n`;
	appendFileSync(dispatchesPath, line, { mode: 0o600 });
	try {
		chmodSync(dispatchesPath, 0o600);
	} catch {}
}

export function loadLoopDispatches(stateDir: string): any[] {
	const dispatchesPath = join(stateDir, "dispatches.jsonl");
	if (!existsSync(dispatchesPath)) return [];
	try {
		return readFileSync(dispatchesPath, "utf8")
			.trim()
			.split("\n")
			.filter(Boolean)
			.map((line) => JSON.parse(line));
	} catch {
		return [];
	}
}

export function saveLease(stateDir: string, lease: LoopLease): void {
	const { leasesDir } = ensureLoopStateDir(stateDir);
	const leasePath = join(leasesDir, `${lease.target_id}.lease.json`);
	const tempPath = join(leasesDir, `${lease.target_id}.${randomUUID()}.tmp`);

	const payload = `${JSON.stringify(lease, null, 2)}\n`;
	writeFileSync(tempPath, payload, { mode: 0o600 });
	try {
		chmodSync(tempPath, 0o600);
	} catch {}

	renameSync(tempPath, leasePath);
	try {
		chmodSync(leasePath, 0o600);
	} catch {}
}

export function loadLease(stateDir: string, targetId: string): LoopLease | null {
	const leasePath = join(stateDir, "leases", `${targetId}.lease.json`);
	if (!existsSync(leasePath)) return null;

	try {
		const raw = readFileSync(leasePath, "utf8");
		const parsed = JSON.parse(raw) as LoopLease;
		if (parsed && parsed.contract === LOOP_DAEMON_LEASE_CONTRACT) {
			return parsed;
		}
	} catch {}
	return null;
}

export function listLeases(stateDir: string): LoopLease[] {
	const leasesDir = join(stateDir, "leases");
	if (!existsSync(leasesDir)) return [];

	const results: LoopLease[] = [];
	try {
		const files = readdirSync(leasesDir);
		for (const file of files) {
			if (file.endsWith(".lease.json")) {
				const full = join(leasesDir, file);
				try {
					const raw = readFileSync(full, "utf8");
					const parsed = JSON.parse(raw) as LoopLease;
					if (parsed && parsed.contract === LOOP_DAEMON_LEASE_CONTRACT) {
						results.push(parsed);
					}
				} catch {}
			}
		}
	} catch {}
	return results;
}

export function deleteLease(stateDir: string, targetId: string): boolean {
	const leasePath = join(stateDir, "leases", `${targetId}.lease.json`);
	if (!existsSync(leasePath)) return false;

	try {
		rmSync(leasePath, { force: true });
		return true;
	} catch {
		return false;
	}
}
