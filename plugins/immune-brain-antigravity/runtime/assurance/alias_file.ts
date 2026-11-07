// Reads one user command alias, or probes for a same-named local skill, for phase
// entry recognition. An alias may be a symlink, so the size bound is taken from
// the opened file, never from the link.

import { closeSync, constants, fstatSync, openSync, readSync, statSync } from "node:fs";
import { join } from "node:path";

export const MAX_ALIAS_BYTES = 64 * 1024;

/**
 * The alias body, or null only when no file is there. A file that is present but
 * unreadable, not a regular file, or over the bound throws, so the caller fails closed.
 */
export function readAliasFile(path: string, maxBytes = MAX_ALIAS_BYTES): string | null {
	let fd: number;
	try {
		fd = openSync(path, constants.O_RDONLY | constants.O_NONBLOCK);
	} catch (error) {
		if (isAbsent(error)) return null;
		throw error;
	}
	try {
		const stat = fstatSync(fd);
		if (!stat.isFile()) throw new Error(`alias is not a regular file: ${path}`);
		if (stat.size > maxBytes) throw new Error(`alias exceeds ${maxBytes} bytes: ${path}`);
		// One byte past the bound: a file that grew after the stat is refused too.
		const buf = Buffer.alloc(maxBytes + 1);
		const read = readSync(fd, buf, 0, buf.length, 0);
		if (read > maxBytes) throw new Error(`alias exceeds ${maxBytes} bytes: ${path}`);
		return buf.toString("utf8", 0, read);
	} finally {
		closeSync(fd);
	}
}

/** Whether `<dir>/<name>/SKILL.md` exists; anything but a clean absence counts as present (fails closed). */
export function localSkillExists(dir: string, name: string): boolean {
	try {
		statSync(join(dir, name, "SKILL.md"));
		return true;
	} catch (error) {
		return !isAbsent(error);
	}
}

function isAbsent(error: unknown): boolean {
	const code = (error as NodeJS.ErrnoException).code;
	return code === "ENOENT" || code === "ENOTDIR";
}
