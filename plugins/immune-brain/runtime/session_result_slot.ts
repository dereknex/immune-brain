// Session result slot (ADR 0038 amendment, #565).
//
// One directory inside a supervised session's own working directory that
// carries the caller's brief in and the agent's result out. It lives under
// the worktree-local `.imm/state/`, so a Host never sees a new directory to
// trust (no `--add-dir`), and it writes its own `*` ignore file, so neither
// `git status` nor a tree guard over HEAD, the index and tracked content ever
// sees it. The slot is transport, never authority: the caller validates the
// result bytes. It sits beside, not inside, `runtime/session/`, so the
// assurance modules that read a result import no session adapter (BR-OUT-1).

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { SESSION_RESULT_SLOTS_RELATIVE } from "./kernel/storage_paths";

const SLOT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export interface ResultSlot {
	directory: string;
	/** What the caller hands the agent; written once at allocation. */
	brief: string;
	/** The single file the agent writes; its bytes are the result. */
	result: string;
}

/** A fresh, empty, ignored directory for one session round. An existing directory of the same id is replaced. */
export function freshSlotDirectory(cwd: string, id: string): string {
	if (!SLOT_ID.test(id) || id.includes("..")) throw new Error(`result slot id is invalid: ${JSON.stringify(id)}`);
	const sessions = join(cwd, SESSION_RESULT_SLOTS_RELATIVE);
	mkdirSync(sessions, { recursive: true });
	const ignore = join(sessions, ".gitignore");
	if (!existsSync(ignore)) writeFileSync(ignore, "*\n");
	const directory = join(sessions, id);
	rmSync(directory, { recursive: true, force: true });
	mkdirSync(directory);
	return directory;
}

/** Create a fresh slot for one session round and write its brief. */
export function allocateResultSlot(cwd: string, id: string, brief: string, briefName = "brief.md"): ResultSlot {
	const directory = freshSlotDirectory(cwd, id);
	const slot = { directory, brief: join(directory, briefName), result: join(directory, "result.json") };
	writeFileSync(slot.brief, brief, { encoding: "utf8", flag: "wx" });
	return slot;
}

/** The result bytes, or null while the agent has not written them. */
export function readSlotResult(slot: ResultSlot): string | null {
	try {
		return readFileSync(slot.result, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
		throw error;
	}
}

export function releaseResultSlot(slot: ResultSlot): void {
	rmSync(slot.directory, { recursive: true, force: true });
}
