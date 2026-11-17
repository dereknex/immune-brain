import { afterAll, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { allocateResultSlot, readSlotResult, releaseResultSlot, writeSlotResult } from "../plugins/immune-brain/runtime/session_result_slot";
import { createMcpRuntime, listMcpTools, TOOLS } from "../plugins/immune-brain/runtime/claude/mcp_server";

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

// --- Spec review-receipt-mcp-submission D2, D3, D4: the MCP submission ------

describe("submit_session_result", () => {
	const bytes = '{"decision":"pass"}\n';
	const digestOf = (value: string) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
	const submit = (root: string, slotId: string, result: string) =>
		createMcpRuntime({ cwd: root }).callTool("submit_session_result", { slot_id: slotId, result });

	test("writes the exact bytes into the allocated slot and reports their digest", async () => {
		const root = repo();
		const slot = allocateResultSlot(root, "review-op-1", "brief");
		// The same writer the tool dispatches to, so a mismatch between the two cannot pass.
		expect(await submit(root, "review-op-1", bytes)).toEqual({
			contract: "immune_brain/session_result/v1", slot_id: "review-op-1", sha256: digestOf(bytes),
		});
		expect(readSlotResult(slot)).toBe(bytes);
		expect(readFileSync(slot.result, "utf8")).toBe(bytes);
	});

	test("a second submission keeps the first bytes", async () => {
		const root = repo();
		const slot = allocateResultSlot(root, "review-op-2", "brief");
		await submit(root, "review-op-2", bytes);
		await expect(submit(root, "review-op-2", '{"decision":"rework"}')).rejects.toThrow("session_result_already_submitted");
		expect(readSlotResult(slot)).toBe(bytes);
	});

	test.each([
		["a traversal id", "../x", "{}", "session_result_slot_invalid"],
		["an empty id", "", "{}", "session_result_slot_invalid"],
		["an id with no allocated slot", "verify-absent", "{}", "session_result_slot_unknown"],
		["a JSON array", "review-op-3", "[1]", "session_result_not_json"],
		["plain text", "review-op-3", "pass", "session_result_not_json"],
		["a fenced JSON block", "review-op-3", "```json\n{}\n```", "session_result_not_json"],
	])("%s is refused and writes nothing", async (_label, slotId, result, code) => {
		const root = repo();
		const slot = allocateResultSlot(root, "review-op-3", "brief");
		await expect(submit(root, slotId, result)).rejects.toThrow(code);
		expect(readSlotResult(slot)).toBeNull();
	});

	test("a symlinked slot directory is refused", async () => {
		const root = repo();
		const outside = repo();
		const real = allocateResultSlot(outside, "review-op-4", "brief");
		mkdirSync(join(root, ".imm/state/sessions"), { recursive: true });
		symlinkSync(real.directory, join(root, ".imm/state/sessions/review-op-4"));
		await expect(submit(root, "review-op-4", "{}")).rejects.toThrow("session_result_slot_unknown");
		expect(readSlotResult(real)).toBeNull();
	});

	test("is listed after answer_loop_interaction as a plain, task-less tool", () => {
		const tools = listMcpTools();
		const names = tools.map((tool) => tool.name);
		expect(names.indexOf("submit_session_result")).toBe(names.indexOf("answer_loop_interaction") + 1);
		const tool = tools.find((item) => item.name === "submit_session_result")!;
		expect(tool.inputSchema.required).toEqual(["slot_id", "result"]);
		expect(Object.keys(tool.inputSchema.properties)).toEqual(["slot_id", "result"]);
		expect(tool.annotations).toEqual({ readOnlyHint: false });
		expect(TOOLS.find((item) => item.name === "submit_session_result")?.privileged).toBe(false);
	});
});
