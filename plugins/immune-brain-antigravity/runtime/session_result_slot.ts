// Session result slot (ADR 0038 amendments, #565 and the MCP submission).
//
// One directory inside a supervised session's own working directory that
// carries the caller's brief in and the session's result out. On Claude Code and
// Antigravity the runtime writes the result through `submit_session_result`, so a
// reviewer holds no file write at all (Spec review-receipt-mcp-submission D1); Pi
// still writes the file with its own tool. It lives under
// the worktree-local `.imm/state/`, so a Host never sees a new directory to
// trust (no `--add-dir`), and it writes its own `*` ignore file, so neither
// `git status` nor a tree guard over HEAD, the index and tracked content ever
// sees it. The slot is transport, never authority: the caller validates the
// result bytes. It sits beside, not inside, `runtime/session/`, so the
// assurance modules that read a result import no session adapter (BR-OUT-1).

import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { SESSION_RESULT_SLOTS_RELATIVE } from "./kernel/storage_paths";

const SLOT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const RESULT_NAME = "result.json";

export interface ResultSlot {
	directory: string;
	/** What the caller hands the agent; written once at allocation. */
	brief: string;
	/** The single file the result goes to; its bytes are the result. */
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
	const slot = { directory, brief: join(directory, briefName), result: join(directory, RESULT_NAME) };
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

/** One strict JSON object: no prose, fences or surrounding lines (D2, D3). */
export function isStrictJsonObject(bytes: string): boolean {
	const trimmed = bytes.trim();
	if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return false;
	try {
		const parsed: unknown = JSON.parse(trimmed);
		return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed);
	} catch {
		return false;
	}
}

/**
 * Write one session's result into an allocated slot (Spec review-receipt-mcp-submission
 * D3): the MCP tool's whole job, so an agent under `dontAsk` in a Lane worktree under
 * `.git/` never needs a file write. Every refusal writes nothing; the returned digest is
 * over the exact bytes written.
 */
export function writeSlotResult(workspace: string, id: string, result: string): string {
	if (!SLOT_ID.test(id) || id.includes(".."))
		throw new Error(`session_result_slot_invalid: ${JSON.stringify(id)} is not a result slot id`);
	const directory = join(workspace, SESSION_RESULT_SLOTS_RELATIVE, id);
	let allocated = false;
	try {
		const stat = lstatSync(directory);
		allocated = stat.isDirectory() && !stat.isSymbolicLink();
	} catch {
		allocated = false;
	}
	if (!allocated || !readdirSync(directory).some((name) => name !== RESULT_NAME))
		throw new Error(`session_result_slot_unknown: no result slot ${JSON.stringify(id)} holds a brief in this workspace`);
	const target = join(directory, RESULT_NAME);
	let submitted = false;
	try {
		lstatSync(target);
		submitted = true;
	} catch {
		submitted = false;
	}
	if (submitted)
		throw new Error(`session_result_already_submitted: result slot ${JSON.stringify(id)} already holds its result`);
	if (!isStrictJsonObject(result))
		throw new Error("session_result_not_json: result must be one strict JSON object");
	// `wx` keeps the one-writer rule: a racing second call fails instead of overwriting.
	writeFileSync(target, result, { encoding: "utf8", flag: "wx" });
	return `sha256:${createHash("sha256").update(result).digest("hex")}`;
}
