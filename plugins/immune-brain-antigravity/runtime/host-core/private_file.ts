// Private per-user cache files shared by the Claude Code and Antigravity adapters
// (Spec docs/specs/host-neutral-adapter-core.spec.md D3).
//
// Interface: `sessionHash`, `cacheDir(root, cacheName)`, `ownedByUs`,
// `ensurePrivateDir`, `appendPrivate`, `readPrivate`.
// Invariants: a directory is used only when it is owned by this user with mode
// 0700; a file only when it is owned, a regular file, mode 0600 and opened
// O_NOFOLLOW. A symlink planted where the cache belongs is never followed.
// Side Effects: creates the cache directory, appends or reads one file in it.
// Verification: `bun test tests/dual-host-assurance-conformance.test.ts -t 'shared hook event log'`.

import { createHash } from "node:crypto";
import { constants, closeSync, fstatSync, lstatSync, mkdirSync, openSync, readSync, writeSync } from "node:fs";
import { join } from "node:path";

export function sessionHash(sessionId: string): string {
	return createHash("sha256").update(sessionId).digest("hex");
}

export function cacheDir(root: string, cacheName: string): string {
	return join(root, cacheName);
}

export function ownedByUs(stat: { uid: number; isSymbolicLink(): boolean }): boolean {
	if (stat.isSymbolicLink()) return false;
	const uid = process.getuid?.();
	return uid === undefined || stat.uid === uid;
}

export function ensurePrivateDir(dir: string): boolean {
	try {
		const existing = lstatSync(dir);
		return existing.isDirectory() && ownedByUs(existing) && (existing.mode & 0o777) === 0o700;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") return false;
	}
	try { mkdirSync(dir, { mode: 0o700 }); } catch { return false; }
	try {
		const created = lstatSync(dir);
		return created.isDirectory() && ownedByUs(created) && (created.mode & 0o777) === 0o700;
	} catch {
		return false;
	}
}

export function appendPrivate(path: string, dir: string, line: string): boolean {
	if (!ensurePrivateDir(dir)) return false;
	const flags = constants.O_WRONLY | constants.O_CREAT | constants.O_APPEND | constants.O_NOFOLLOW | constants.O_NONBLOCK;
	let fd: number;
	try { fd = openSync(path, flags, 0o600); } catch { return false; }
	try {
		const stat = fstatSync(fd);
		if (!stat.isFile() || !ownedByUs(stat) || (stat.mode & 0o777) !== 0o600) return false;
		return writeSync(fd, line) === Buffer.byteLength(line);
	} catch {
		return false;
	} finally {
		closeSync(fd);
	}
}

export function readPrivate(path: string, maxBytes = Number.POSITIVE_INFINITY): string | undefined {
	let fd: number;
	try { fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); } catch { return; }
	try {
		const stat = fstatSync(fd);
		if (!stat.isFile() || !ownedByUs(stat) || (stat.mode & 0o777) !== 0o600) return;
		if (stat.size > maxBytes) return;
		const buf = Buffer.alloc(stat.size);
		readSync(fd, buf, 0, stat.size, 0);
		return buf.toString("utf8");
	} finally {
		closeSync(fd);
	}
}
