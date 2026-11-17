import { afterAll, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { allocateResultSlot, readSlotResult, releaseResultSlot } from "../plugins/immune-brain/runtime/session_result_slot";

const scratch: string[] = [];
afterAll(() => { for (const dir of scratch) rmSync(dir, { recursive: true, force: true }); });

function repo(): string {
	const root = realpathSync(mkdtempSync(join(tmpdir(), "imm-result-slot-")));
	scratch.push(root);
	execFileSync("git", ["init", "-q"], { cwd: root });
	return root;
}

describe("session result slot", () => {
	test("lives inside the session cwd and is invisible to git status", () => {
		const root = repo();
		const slot = allocateResultSlot(root, "op-1", "brief text");
		expect(slot.brief.startsWith(join(root, ".imm/state/sessions/op-1/"))).toBe(true);
		expect(slot.result.startsWith(join(root, ".imm/state/sessions/op-1/"))).toBe(true);
		writeFileSync(slot.result, "{}");
		// Ignored even in a repository that has no .gitignore of its own.
		const status = execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: root, encoding: "utf8" });
		expect(status).toBe("");
	});

	test("result is null until written, then the exact bytes", () => {
		const root = repo();
		const slot = allocateResultSlot(root, "op-2", "brief");
		expect(readSlotResult(slot)).toBeNull();
		writeFileSync(slot.result, '{"a":1}\n');
		expect(readSlotResult(slot)).toBe('{"a":1}\n');
	});

	test("release removes the slot and leaves sibling slots", () => {
		const root = repo();
		const first = allocateResultSlot(root, "op-3", "brief");
		const second = allocateResultSlot(root, "op-4", "brief");
		releaseResultSlot(first);
		expect(existsSync(first.directory)).toBe(false);
		expect(existsSync(second.brief)).toBe(true);
	});

	test("refuses an id that could leave the sessions directory", () => {
		const root = repo();
		expect(() => allocateResultSlot(root, "../escape", "brief")).toThrow();
		expect(() => allocateResultSlot(root, "a/b", "brief")).toThrow();
	});
});
