/**
 * Loop Daemon: Lock Management (S1)
 *
 * Implements S1 and D2 of docs/specs/loop-daemon.spec.md.
 * Manages daemon.lock with 0600 permissions, ensuring single-instance execution
 * and rejecting concurrent ticks when held by a live PID.
 */

import { chmodSync, existsSync, linkSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { randomUUID } from "node:crypto";
import { LOOP_DAEMON_LOCK_CONTRACT, type LoopDaemonLock } from "./types.ts";

export function isPidAlive(pid: number): boolean {
	if (typeof pid !== "number" || !Number.isInteger(pid) || pid <= 0) {
		return false;
	}
	try {
		process.kill(pid, 0);
		return true;
	} catch (error: any) {
		if (error && error.code === "EPERM") {
			return true;
		}
		return false;
	}
}

export interface AcquireLockSuccess {
	acquired: true;
	lock: LoopDaemonLock;
	release: () => void;
}

export interface AcquireLockFailure {
	acquired: false;
	existing: LoopDaemonLock | null;
	reason: string;
}

export type AcquireLockResult = AcquireLockSuccess | AcquireLockFailure;

export function readDaemonLock(stateDir: string): {
	exists: boolean;
	lock: LoopDaemonLock | null;
	isLive: boolean;
} {
	const lockPath = join(stateDir, "daemon.lock");
	if (!existsSync(lockPath)) {
		return { exists: false, lock: null, isLive: false };
	}
	try {
		const raw = readFileSync(lockPath, "utf8");
		const parsed = JSON.parse(raw) as LoopDaemonLock;
		if (parsed && typeof parsed.pid === "number") {
			const live = isPidAlive(parsed.pid);
			return { exists: true, lock: parsed, isLive: live };
		}
	} catch {
		// Corrupt or unreadable lock file
	}
	return { exists: true, lock: null, isLive: false };
}

export function findReclaimClaims(
	stateDir: string,
	staleToken: string,
): Array<{ gen: number; path: string; pid: number | null }> {
	const exactLegacy = `.reclaim.${staleToken}.lock`;
	const prefix = `.reclaim.${staleToken}.`;
	const suffix = `.lock`;
	try {
		const files = readdirSync(stateDir);
		const claims: Array<{ gen: number; path: string; pid: number | null }> = [];
		for (const file of files) {
			let gen: number | null = null;
			if (file === exactLegacy) {
				gen = 0;
			} else if (file.startsWith(prefix) && file.endsWith(suffix)) {
				const genStr = file.slice(prefix.length, file.length - suffix.length);
				const parsedGen = parseInt(genStr, 10);
				if (!Number.isNaN(parsedGen) && parsedGen >= 0) {
					gen = parsedGen;
				}
			}
			if (gen !== null) {
				const filePath = join(stateDir, file);
				let pid: number | null = null;
				try {
					const raw = readFileSync(filePath, "utf8");
					const parsed = JSON.parse(raw);
					if (parsed && typeof parsed.pid === "number") {
						pid = parsed.pid;
					}
				} catch {}
				claims.push({ gen, path: filePath, pid });
			}
		}
		claims.sort((a, b) => a.gen - b.gen);
		return claims;
	} catch {
		return [];
	}
}

export function acquireDaemonLock(
	stateDir: string,
	options?: { hostToken?: string },
): AcquireLockResult {
	mkdirSync(stateDir, { recursive: true, mode: 0o700 });
	const lockPath = join(stateDir, "daemon.lock");

	const hostToken = options?.hostToken ?? randomUUID();
	const now = new Date().toISOString();
	const lockRecord: LoopDaemonLock = {
		contract: LOOP_DAEMON_LOCK_CONTRACT,
		pid: process.pid,
		hostname: hostname(),
		started_at: now,
		host_token: hostToken,
		heartbeat_at: now,
	};

	const release = (): void => {
		try {
			if (existsSync(lockPath)) {
				const current = readDaemonLock(stateDir);
				if (
					current.lock &&
					current.lock.host_token === hostToken &&
					current.lock.pid === process.pid
				) {
					rmSync(lockPath, { force: true });
				}
			}
		} catch {
			// Best-effort cleanup
		}
	};

	// Prepare our new lock payload in a temporary file in the same directory
	const tmpLockPath = join(
		stateDir,
		`daemon.lock.tmp.${process.pid}.${randomUUID()}`,
	);
	const payload = Buffer.from(
		`${JSON.stringify(lockRecord, null, 2)}\n`,
		"utf8",
	);
	writeFileSync(tmpLockPath, payload, { mode: 0o600 });

	// 1. Attempt atomic creation first (optimistic path via linkSync)
	// linkSync atomically creates lockPath already fully populated with content and mode 0600.
	// This ensures no reader can ever observe an empty or partially written daemon.lock.
	try {
		linkSync(tmpLockPath, lockPath);
		chmodSync(lockPath, 0o600);
		rmSync(tmpLockPath, { force: true });
		return {
			acquired: true,
			lock: lockRecord,
			release,
		};
	} catch (error: any) {
		if (error?.code !== "EEXIST") {
			try {
				rmSync(tmpLockPath, { force: true });
			} catch {}
			return {
				acquired: false,
				existing: null,
				reason: `failed to acquire daemon.lock: ${error?.message || String(error)}`,
			};
		}
	}

	// 2. Lock file exists - check if held by live PID
	const inspection = readDaemonLock(stateDir);
	if (inspection.exists && inspection.lock && inspection.isLive) {
		try {
			rmSync(tmpLockPath, { force: true });
		} catch {}
		return {
			acquired: false,
			existing: inspection.lock,
			reason: `daemon.lock is held by live PID ${inspection.lock.pid} on host ${inspection.lock.hostname}`,
		};
	}

	// 3. Stale or dead PID lock: claim mutual exclusion for this specific stale lock instance.
	// We use monotonic claim generations (.reclaim.<token>.<gen>.lock) via linkSync.
	// If a prior claim died, the next reclaimer claims gen+1 WITHOUT removing the prior claim.
	// This guarantees that racing dead-claim recoverers can NEVER unlink each other's live claims!
	const staleToken = inspection.lock?.host_token ?? `pid-${inspection.lock?.pid ?? "unknown"}`;
	const existingClaims = findReclaimClaims(stateDir, staleToken);
	const liveClaim = existingClaims.find((c) => c.pid !== null && isPidAlive(c.pid));

	if (liveClaim) {
		try {
			rmSync(tmpLockPath, { force: true });
		} catch {}
		const current = readDaemonLock(stateDir);
		return {
			acquired: false,
			existing: current.lock,
			reason: `stale lock reclamation already claimed by concurrent reclaimer`,
		};
	}

	const maxGen = existingClaims.reduce((max, c) => Math.max(max, c.gen), -1);
	const nextGen = maxGen + 1;
	const reclaimClaimPath = join(stateDir, `.reclaim.${staleToken}.${nextGen}.lock`);
	const tmpClaimPath = join(stateDir, `.reclaim.tmp.${process.pid}.${randomUUID()}`);

	writeFileSync(tmpClaimPath, JSON.stringify({ pid: process.pid, at: now }), { mode: 0o600 });

	let claimAcquired = false;
	try {
		linkSync(tmpClaimPath, reclaimClaimPath);
		claimAcquired = true;
	} catch (linkErr: any) {
		// A concurrent dead-claim recoverer claimed nextGen first!
		try {
			rmSync(tmpLockPath, { force: true });
		} catch {}
		const current = readDaemonLock(stateDir);
		return {
			acquired: false,
			existing: current.lock,
			reason: `stale lock reclamation already claimed by concurrent reclaimer`,
		};
	} finally {
		try {
			rmSync(tmpClaimPath, { force: true });
		} catch {}
	}

	// We hold the mutual exclusion claim for reclaiming staleToken!
	try {
		// Under the claim: verify daemon.lock has NOT been replaced by a live process
		const recheck = readDaemonLock(stateDir);
		if (recheck.exists && recheck.lock && recheck.isLive) {
			return {
				acquired: false,
				existing: recheck.lock,
				reason: `daemon.lock is held by live PID ${recheck.lock.pid} on host ${recheck.lock.hostname}`,
			};
		}
		// Also verify daemon.lock is still the same stale token we claimed
		if (
			recheck.exists &&
			recheck.lock &&
			(recheck.lock.host_token ?? `pid-${recheck.lock.pid}`) !== staleToken
		) {
			return {
				acquired: false,
				existing: recheck.lock,
				reason: `daemon.lock was replaced by another lock instance`,
			};
		}

		// Atomically replace daemon.lock in a single POSIX directory operation.
		// daemon.lock is NEVER absent at any point, so third processes cannot sneak in.
		renameSync(tmpLockPath, lockPath);
		chmodSync(lockPath, 0o600);

		return {
			acquired: true,
			lock: lockRecord,
			release,
		};
	} catch (error: any) {
		const current = readDaemonLock(stateDir);
		return {
			acquired: false,
			existing: current.lock,
			reason: `failed to acquire daemon.lock during stale reclamation: ${error?.message || String(error)}`,
		};
	} finally {
		if (claimAcquired) {
			try {
				const claimsToClean = findReclaimClaims(stateDir, staleToken);
				for (const c of claimsToClean) {
					try {
						rmSync(c.path, { force: true });
					} catch {}
				}
			} catch {}
		}
		if (existsSync(tmpLockPath)) {
			try {
				rmSync(tmpLockPath, { force: true });
			} catch {}
		}
	}
}
