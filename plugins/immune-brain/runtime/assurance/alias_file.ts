// Reads one user command alias for phase entry recognition. An alias may be a
// symlink, so the size bound is taken from the opened file, never from the link.

import { closeSync, constants, fstatSync, openSync, readSync } from "node:fs";

export const MAX_ALIAS_BYTES = 64 * 1024;

/** The alias body, or null when it is absent, not a regular file, or over the bound. */
export function readAliasFile(path: string, maxBytes = MAX_ALIAS_BYTES): string | null {
	let fd: number;
	try { fd = openSync(path, constants.O_RDONLY | constants.O_NONBLOCK); } catch { return null; }
	try {
		const stat = fstatSync(fd);
		if (!stat.isFile() || stat.size > maxBytes) return null;
		// One byte past the bound: a file that grew after the stat is refused too.
		const buf = Buffer.alloc(maxBytes + 1);
		const read = readSync(fd, buf, 0, buf.length, 0);
		return read > maxBytes ? null : buf.toString("utf8", 0, read);
	} catch {
		return null;
	} finally {
		closeSync(fd);
	}
}
