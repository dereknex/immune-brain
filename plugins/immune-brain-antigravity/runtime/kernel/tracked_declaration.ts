// Fail-closed reader for a project declaration file under Git (ADR 0023).
// A declaration is trusted only when it is a regular file whose bytes equal the
// committed regular blob at HEAD. This module owns that trust check and nothing
// else: callers own the format and the policy each declaration feeds.

import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";

export type TrackedDeclaration =
	| { kind: "absent" }
	| { kind: "invalid"; reason: string }
	| { kind: "present"; value: unknown };

/**
 * Read one committed declaration. Never throws. A missing file is `absent`; a
 * file that is not a tracked, committed, regular, parseable JSON document is
 * `invalid`. An uncommitted declaration is not trusted, so an edit made beside
 * a task cannot change that task's gating.
 */
export function readTrackedDeclaration(root: string, path: string, maxBytes: number): TrackedDeclaration {
	const invalid = (reason: string): TrackedDeclaration => ({ kind: "invalid", reason });
	let canonicalRoot: string;
	try {
		canonicalRoot = realpathSync(root);
	} catch {
		return { kind: "absent" };
	}
	const target = join(canonicalRoot, path);
	let present = false;
	try {
		const stat = lstatSync(target);
		if (!stat.isFile()) return invalid(`${path} is not a regular file`);
		if (stat.size > maxBytes) return invalid(`${path} exceeds ${Math.floor(maxBytes / 1024)} KiB`);
		present = true;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT" && (error as NodeJS.ErrnoException).code !== "ENOTDIR")
			return invalid(`${path} cannot be read`);
	}
	let pending: string;
	try {
		pending = execFileSync(
			"git",
			["--no-optional-locks", "status", "--porcelain=v1", "-z", "--ignored", "--", path],
			{ cwd: canonicalRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
		);
	} catch {
		// Outside a Git repository nothing vouches for the file.
		return present ? invalid(`${path} cannot be checked against Git`) : { kind: "absent" };
	}
	if (pending.length > 0) return invalid(`${path} has changes that are not committed`);
	try {
		const entry = execFileSync("git", ["ls-tree", "HEAD", "--", path],
			{ cwd: canonicalRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
		if (!entry) return present ? invalid(`${path} is not committed`) : { kind: "absent" };
		if (!present || !/^100(?:644|755) blob /.test(entry))
			return invalid(`${path} does not match a committed regular file`);
		const bytes = readFileSync(target);
		const committed = execFileSync("git", ["show", `HEAD:${path}`],
			{ cwd: canonicalRoot, maxBuffer: maxBytes, stdio: ["ignore", "pipe", "pipe"] });
		// Index flags can hide changes from status; compare the bytes we parse.
		if (!bytes.equals(committed)) return invalid(`${path} differs from its committed bytes`);
		return { kind: "present", value: JSON.parse(bytes.toString("utf8")) };
	} catch (error) {
		return present ? invalid(error instanceof Error ? error.message : String(error)) : { kind: "absent" };
	}
}
