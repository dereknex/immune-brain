/**
 * Loop Daemon: Atomic Dispatch Leases (S4)
 *
 * Implements D4.1 of docs/specs/loop-daemon.spec.md. A lease is the exclusive
 * right to work one target, materialized at
 * `.imm/state/loop/leases/<target-id>.lease.json` (mode 0600) with a heartbeat.
 * Creation is atomic: a fully written temp file is `link`ed into place, so no
 * reader ever observes a partial lease and exactly one racer wins. Only the
 * lease's own host token may heartbeat or release it.
 *
 * Heartbeat, release and reclaim are mutually exclusive per target through a
 * generation gate. Without it a heartbeat could rename its refreshed copy over a
 * lease another daemon had just reclaimed, so the gate — not the rename — is what
 * makes those three operations atomic with one another. No path ever acts on a
 * gate it does not own: a contender claims the next generation and gives it back
 * when a live gate of another generation exists, acquisition removes only
 * lower-generation gates that are provably abandoned, and release never unlinks
 * at all — it marks its own gate released. Generations are monotonic because the
 * highest gate file outlives its holder, so a delayed release can never land on a
 * reused live path. A lease is reclaimable when its heartbeat is older than the
 * TTL or its owner PID is dead.
 */

import { chmodSync, linkSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import process from "node:process";
import { randomUUID } from "node:crypto";
import { isPidAlive } from "./lock.ts";
import { deleteLease, ensureLoopStateDir, listLeases, loadLease, saveLease } from "./state.ts";
import { LOOP_DAEMON_LEASE_CONTRACT, type LoopLease } from "./types.ts";

/** A lease whose heartbeat is older than this is reclaimable even if its PID answers. */
export const DEFAULT_LEASE_TTL_MS = 15 * 60 * 1000;

/** A gate held longer than this is treated as abandoned by a dead worker. */
const DEFAULT_GATE_TTL_MS = 30 * 1000;

export interface LeaseExpiryFacts {
	/** The instant expiry is evaluated at; defaults to now. */
	now?: string;
	ttl_ms?: number;
	/** Liveness seam; defaults to the daemon's own PID probe. */
	is_alive?: (pid: number) => boolean;
}

function leaseFilePath(stateDir: string, targetId: string): string {
	return join(stateDir, "leases", `${targetId}.lease.json`);
}

function readLeaseFile(path: string): LoopLease | null {
	try {
		const parsed = JSON.parse(readFileSync(path, "utf8")) as LoopLease;
		if (parsed && parsed.contract === LOOP_DAEMON_LEASE_CONTRACT) return parsed;
	} catch {}
	return null;
}

/** Write `payload` to `target` only if it does not exist, atomically. */
function linkExclusive(leasesDir: string, target: string, name: string, payload: string): boolean {
	const temp = join(leasesDir, `.${name}.${randomUUID()}.tmp`);
	writeFileSync(temp, payload, { mode: 0o600 });
	try {
		chmodSync(temp, 0o600);
	} catch {}
	try {
		linkSync(temp, target);
		return true;
	} catch (error: any) {
		if (error?.code === "EEXIST") return false;
		throw error;
	} finally {
		rmSync(temp, { force: true });
	}
}

interface GateFile {
	gen: number;
	path: string;
}

function gateFiles(leasesDir: string, targetId: string): GateFile[] {
	const prefix = `.${targetId}.gate.`;
	const files: GateFile[] = [];
	try {
		for (const name of readdirSync(leasesDir)) {
			if (!name.startsWith(prefix)) continue;
			const gen = Number.parseInt(name.slice(prefix.length), 10);
			if (!Number.isFinite(gen) || gen <= 0) continue;
			files.push({ gen, path: join(leasesDir, name) });
		}
	} catch {}
	return files.sort((left, right) => left.gen - right.gen);
}

/**
 * A gate nobody is working under any more: it was released, its PID is gone, or
 * it outlived the TTL. A released gate still holds its generation open, which is
 * what keeps a later holder from ever reusing that path.
 */
function gateAbandoned(file: GateFile): boolean {
	try {
		const holder = JSON.parse(readFileSync(file.path, "utf8")) as { pid?: number; at?: string; released?: boolean };
		if (holder?.released === true) return true;
		const at = Date.parse(holder?.at ?? "");
		return !isPidAlive(holder?.pid ?? 0) || !Number.isFinite(at) || Date.now() - at >= DEFAULT_GATE_TTL_MS;
	} catch {
		return true;
	}
}

/**
 * Take the target's mutation gate. Mutual exclusion never depends on deleting
 * another holder's gate: a contender only creates its own generation, and it
 * gives the gate back when a live gate of another generation exists. Only
 * generations that are provably abandoned *and* older than ours are removed,
 * which is safe because the post-claim scan has just proven no other live gate
 * exists.
 */
function acquireGate(stateDir: string, targetId: string): { path: string; gen: number } | null {
	const { leasesDir } = ensureLoopStateDir(stateDir);
	const before = gateFiles(leasesDir, targetId);
	if (before.some((file) => !gateAbandoned(file))) return null;

	const generation = (before.at(-1)?.gen ?? 0) + 1;
	const path = join(leasesDir, `.${targetId}.gate.${generation}`);
	const payload = `${JSON.stringify({ pid: process.pid, at: new Date().toISOString(), gen: generation })}\n`;
	if (!linkExclusive(leasesDir, path, `gate.${targetId}.${generation}`, payload)) return null;

	// A racer may have claimed another generation in the same window; exactly one live gate may remain.
	const contested = gateFiles(leasesDir, targetId).some((file) => file.path !== path && !gateAbandoned(file));
	if (contested) {
		rmSync(path, { force: true });
		return null;
	}
	for (const file of before) if (file.path !== path) rmSync(file.path, { force: true });
	return { path, gen: generation };
}

/**
 * Give back exactly the gate this caller created. It is never unlinked: marking
 * it released keeps the generation allocated, so a delayed former holder can only
 * ever touch its own — already superseded — path, never a live one.
 */
function releaseGate(path: string, targetId: string, generation: number): void {
	const temp = join(dirname(path), `.${targetId}.release.${generation}.${randomUUID()}.tmp`);
	writeFileSync(temp, `${JSON.stringify({ pid: process.pid, at: new Date().toISOString(), gen: generation, released: true })}\n`, {
		mode: 0o600,
	});
	try {
		chmodSync(temp, 0o600);
	} catch {}
	try {
		renameSync(temp, path);
	} finally {
		rmSync(temp, { force: true });
	}
}

/**
 * Expiry, fail-closed in the other direction: an unreadable heartbeat counts as
 * expired, so a corrupt lease cannot pin a target forever.
 */
export function leaseExpired(lease: LoopLease, facts: LeaseExpiryFacts = {}): boolean {
	const now = Date.parse(facts.now ?? new Date().toISOString());
	const heartbeat = Date.parse(lease.heartbeat_at);
	if (!Number.isFinite(heartbeat)) return true;
	if (now - heartbeat >= (facts.ttl_ms ?? DEFAULT_LEASE_TTL_MS)) return true;
	return !(facts.is_alive ?? isPidAlive)(lease.owner_pid);
}

/** Create `target` only if absent, atomically: the linked file is never partial. */
function createLeaseExclusive(stateDir: string, lease: LoopLease): boolean {
	const { leasesDir } = ensureLoopStateDir(stateDir);
	return linkExclusive(leasesDir, leaseFilePath(stateDir, lease.target_id), `lease.${lease.target_id}`, `${JSON.stringify(lease, null, 2)}\n`);
}

export interface LeaseRequest {
	target_id: string;
	kind: LoopLease["kind"];
	scope_hint?: string[];
	worktree_path?: string;
	owner_pid?: number;
	host_token?: string;
	now?: string;
}

export type LeaseAcquireResult =
	| { acquired: true; lease: LoopLease; reclaimed: LoopLease | null }
	| { acquired: false; lease: LoopLease | null; reason: string };

function newLease(request: LeaseRequest): LoopLease {
	const now = request.now ?? new Date().toISOString();
	return {
		contract: LOOP_DAEMON_LEASE_CONTRACT,
		target_id: request.target_id,
		kind: request.kind,
		owner_pid: request.owner_pid ?? process.pid,
		host_token: request.host_token ?? randomUUID(),
		worktree_path: request.worktree_path,
		scope_hint: [...(request.scope_hint ?? [])],
		acquired_at: now,
		heartbeat_at: now,
		status: "active",
	};
}

/**
 * Acquire the lease for one target, reclaiming it first when the incumbent is
 * expired. A live incumbent is never disturbed: the caller gets its lease back
 * as evidence for guard `G4`.
 */
export function acquireLoopLease(
	stateDir: string,
	request: LeaseRequest,
	expiry: LeaseExpiryFacts = {},
): LeaseAcquireResult {
	const lease = newLease(request);
	if (createLeaseExclusive(stateDir, lease)) return { acquired: true, lease, reclaimed: null };

	const gate = acquireGate(stateDir, request.target_id);
	if (gate === null) {
		return {
			acquired: false,
			lease: readLeaseFile(leaseFilePath(stateDir, request.target_id)),
			reason: `lease takeover of ${request.target_id} is gated by another daemon`,
		};
	}
	try {
		const existing = readLeaseFile(leaseFilePath(stateDir, request.target_id));
		if (existing === null) {
			return createLeaseExclusive(stateDir, lease)
				? { acquired: true, lease, reclaimed: null }
				: { acquired: false, lease: null, reason: `lease file for ${request.target_id} is unreadable` };
		}
		if (!leaseExpired(existing, expiry)) {
			return {
				acquired: false,
				lease: existing,
				reason: `leased by live pid ${existing.owner_pid} until heartbeat ${existing.heartbeat_at}`,
			};
		}

		// Rename the stale lease out of the way first; a racing reclaimer gets ENOENT.
		const stalePath = join(stateDir, "leases", `${request.target_id}.${randomUUID()}.reclaimed.tmp`);
		try {
			renameSync(leaseFilePath(stateDir, request.target_id), stalePath);
		} catch {
			return {
				acquired: false,
				lease: readLeaseFile(leaseFilePath(stateDir, request.target_id)),
				reason: "lease takeover lost a race to another reclaimer",
			};
		}
		rmSync(stalePath, { force: true });

		if (!createLeaseExclusive(stateDir, lease)) {
			return {
				acquired: false,
				lease: readLeaseFile(leaseFilePath(stateDir, request.target_id)),
				reason: "lease takeover lost a race to another daemon",
			};
		}
		return { acquired: true, lease, reclaimed: existing };
	} finally {
		releaseGate(gate.path, request.target_id, gate.gen);
	}
}

/**
 * Refresh one owned lease. A missing lease, another owner's, or a target being
 * reclaimed right now is left untouched and reports null.
 */
export function heartbeatLoopLease(
	stateDir: string,
	targetId: string,
	options: { host_token: string; now?: string },
): LoopLease | null {
	const gate = acquireGate(stateDir, targetId);
	if (gate === null) return null;
	try {
		const lease = loadLease(stateDir, targetId);
		if (lease === null || lease.host_token !== options.host_token) return null;
		// Holding the gate is what makes this write safe: no reclaim can replace
		// the file between this read and the rename inside `saveLease`.
		const next: LoopLease = { ...lease, heartbeat_at: options.now ?? new Date().toISOString() };
		saveLease(stateDir, next);
		return next;
	} finally {
		releaseGate(gate.path, targetId, gate.gen);
	}
}

/** Release one owned lease. Another host's lease is never released. */
export function releaseLoopLease(stateDir: string, targetId: string, options: { host_token: string }): boolean {
	const gate = acquireGate(stateDir, targetId);
	if (gate === null) return false;
	try {
		const lease = loadLease(stateDir, targetId);
		if (lease === null || lease.host_token !== options.host_token) return false;
		return deleteLease(stateDir, targetId);
	} finally {
		releaseGate(gate.path, targetId, gate.gen);
	}
}

/** Reclaim every expired lease in one pass and report what was taken back. */
export function reclaimExpiredLeases(stateDir: string, expiry: LeaseExpiryFacts = {}): LoopLease[] {
	const reclaimed: LoopLease[] = [];
	for (const candidate of listLeases(stateDir)) {
		const gate = acquireGate(stateDir, candidate.target_id);
		if (gate === null) continue;
		try {
			// Expiry is re-evaluated under the gate: a heartbeat that landed first wins.
			const lease = readLeaseFile(leaseFilePath(stateDir, candidate.target_id));
			if (lease === null || !leaseExpired(lease, expiry)) continue;
			const stalePath = join(stateDir, "leases", `${lease.target_id}.${randomUUID()}.reclaimed.tmp`);
			try {
				renameSync(leaseFilePath(stateDir, lease.target_id), stalePath);
			} catch {
				continue;
			}
			rmSync(stalePath, { force: true });
			reclaimed.push(lease);
		} finally {
			releaseGate(gate.path, candidate.target_id, gate.gen);
		}
	}
	return reclaimed;
}
