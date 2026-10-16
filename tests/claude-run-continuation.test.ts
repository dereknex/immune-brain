import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { canonicalIntentHash, parseTaskIntentV1 } from "../plugins/immune-brain/runtime/kernel/intent";
import { recordPhaseEntryPrompt } from "../plugins/immune-brain/runtime/claude/lane_guard";
import { readRunToolSession, runContinuationHookOutput } from "../plugins/immune-brain/runtime/claude/run_continuation";
import { seedKernelRunForTest } from "./fixtures/mutation-authority-test-seam";

function fixture() {
	const root = mkdtempSync(join(tmpdir(), "gdr-claude-"));
	const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
	git("init", "-q"); git("config", "user.name", "Fixture"); git("config", "user.email", "fixture@example.test");
	mkdirSync(join(root, "docs/plans"), { recursive: true });
	writeFileSync(join(root, ".gitignore"), ".imm/\nimmune-brain-claude/\n"); writeFileSync(join(root, "value.txt"), "before\n");
	const intent = parseTaskIntentV1({ contract: "assurance_kernel/task_intent/v1", task_id: "slice-a", goal: "Change value",
		acceptance: [{ id: "A1", assertion: "Value changes", verification: "bun test tests/value.test.ts" }],
		scope_hint: ["value.txt", "docs/plans/slice-a.intent.json"], risk: "material", revision: 1, owner: "user" });
	writeFileSync(join(root, "docs/plans/slice-a.intent.json"), JSON.stringify(intent, null, 2) + "\n");
	git("add", "."); git("commit", "-qm", "fixture");
	seedKernelRunForTest(root, { task_id: "slice-a", run_id: "run-a", record: {
		contract: "assurance_kernel/task_record/v4", task_id: "slice-a", intent_snapshot: intent,
		intent_ref: { path: "docs/plans/slice-a.intent.json", content_hash: canonicalIntentHash(intent) },
		lifecycle: "active", artifact_state: "active", baseline: `sha256:${"a".repeat(64)}`,
		git_base_head: git("rev-parse", "HEAD"), attestations: [], findings: [], history: [],
	} });
	let sequence = 0;
	const base = { cwd: root, session_id: "hook-session" };
	const hook = (event: Record<string, unknown>) => runContinuationHookOutput({ ...base, ...event }, root);
	const prompt = async (text: string) => {
		const event = { ...base, hook_event_name: "UserPromptSubmit", prompt: text };
		recordPhaseEntryPrompt(event, { root }); await hook(event);
	};
	const tool = (operation = "status") => ({ tool_name: `mcp__plugin_immune-brain_immune-brain__${operation}`,
		tool_use_id: `tool-${++sequence}`, tool_input: { task_id: "slice-a" } });
	const enter = async () => {
		await prompt("/imm-run slice-a"); const event = tool();
		await hook({ hook_event_name: "PreToolUse", ...event });
		await hook({ hook_event_name: "PostToolUse", ...event, tool_response: {} });
	};
	let boundary = 0;
	const transcript = join(root, ".imm", "transcript.jsonl");
	const stop = (duplicate = false) => {
		if (!duplicate) appendFileSync(transcript, JSON.stringify({ type: "assistant", uuid: `assistant-${++boundary}`, message: { role: "assistant" } }) + "\n");
		return hook({ hook_event_name: "Stop", stop_hook_active: true, transcript_path: transcript });
	};
	return { root, hook, prompt, tool, enter, stop, dispose: () => rmSync(root, { recursive: true, force: true }) };
}

describe("Claude run continuation", () => {
	test("unbound Stop is silent; exact run entry, Hook and Kernel facts bind", async () => {
		const h = fixture(); try {
			expect(await h.stop()).toBeNull(); await h.enter();
			expect(JSON.parse((await h.stop())!)).toMatchObject({ decision: "block" });
			await h.prompt("What remains?"); writeFileSync(join(h.root, "value.txt"), "edited\n");
			expect(JSON.parse((await h.stop())!)).toMatchObject({ decision: "block" });
		} finally { h.dispose(); }
	});

	test("a wrong session or workspace cannot consume another Hook's result", async () => {
		const h = fixture(); try {
			await h.prompt("/imm-run slice-a"); const event = h.tool();
			await h.hook({ hook_event_name: "PreToolUse", ...event });
			expect(readRunToolSession(event.tool_use_id, "status", h.root, h.root)).toBe("hook-session");
			expect(readRunToolSession(event.tool_use_id, "enroll", h.root, h.root)).toBeNull();
			expect(readRunToolSession(event.tool_use_id, "status", tmpdir(), h.root)).toBeNull();
			await h.hook({ hook_event_name: "PostToolUse", ...event, session_id: "another-session", tool_response: {} });
			expect(await h.stop()).toBeNull();
			await h.hook({ hook_event_name: "PostToolUse", ...event, tool_response: {} });
			expect(JSON.parse((await h.stop())!)).toMatchObject({ decision: "block" });
			// Correlation is one-use, even across MCP transport reconnections.
			expect(readRunToolSession(event.tool_use_id, "status", h.root, h.root)).toBeNull();
		} finally { h.dispose(); }
	});

	test("an unchanged digest blocks once then pauses; source edits block again", async () => {
		const h = fixture(); try {
			await h.enter(); expect(JSON.parse((await h.stop())!).decision).toBe("block");
			writeFileSync(join(h.root, "value.txt"), "after\n");
			expect(JSON.parse((await h.stop())!).decision).toBe("block");
			expect(JSON.parse((await h.stop())!)).toMatchObject({ systemMessage: expect.stringContaining("no substantive progress") });
		} finally { h.dispose(); }
	});

	test("the block reason says a user-only wait is a valid stop and must not repeat the request", async () => {
		const h = fixture(); try {
			await h.enter();
			const reason = JSON.parse((await h.stop())!).reason as string;
			expect(reason).toContain("only the user can perform");
			expect(reason).toContain("valid stop");
			expect(reason).toContain("without repeating the request");
		} finally { h.dispose(); }
	});

	test.each(["取消任务", "/imm-planner", "/imm-brainstorm"])("%s releases the binding", async prompt => {
		const h = fixture(); try { await h.enter(); await h.prompt(prompt); expect(await h.stop()).toBeNull(); }
		finally { h.dispose(); }
	});

	test("a failed native gate is reported and cannot be automatically retried", async () => {
		const h = fixture(); try {
			await h.enter(); const event = h.tool("request_authorization");
			await h.hook({ hook_event_name: "PreToolUse", ...event });
			await h.hook({ hook_event_name: "PostToolUseFailure", ...event, error: "cancelled" });
			expect(JSON.parse((await h.stop())!)).toMatchObject({ systemMessage: expect.stringContaining("no automatic native retry") });
			const retry = await h.hook({ hook_event_name: "PreToolUse", ...h.tool("enroll") });
			expect(JSON.parse(retry!)).toMatchObject({ hookSpecificOutput: { permissionDecision: "deny" } });
			await h.enter(); expect(JSON.parse((await h.stop())!).decision).toBe("block");
		} finally { h.dispose(); }
	});

	test("the actual MCP text-block array reports native rejection and pauses", async () => {
		const h = fixture(); try {
			await h.enter(); const event = h.tool("request_authorization");
			await h.hook({ hook_event_name: "PreToolUse", ...event });
			await h.hook({ hook_event_name: "PostToolUse", ...event,
				tool_response: [{ type: "text", text: JSON.stringify({ state: "rejected" }) }] });
			expect(JSON.parse((await h.stop())!)).toMatchObject({ systemMessage: expect.stringContaining("did not apply") });
		} finally { h.dispose(); }
	});

	test("duplicate and unidentifiable Stop callbacks yield without spending stall budget", async () => {
		const h = fixture(); try {
			await h.enter();
			expect(await h.hook({ hook_event_name: "Stop", stop_hook_active: true })).toBeNull();
			expect(JSON.parse((await h.stop())!).decision).toBe("block");
			expect(await h.stop(true)).toBeNull(); expect(await h.stop(true)).toBeNull();
			expect(JSON.parse((await h.stop())!).systemMessage).toContain("no substantive progress");
		} finally { h.dispose(); }
	});

	test("a changed workspace releases the run before observing old authority", async () => {
		const h = fixture(); try {
			await h.enter();
			expect(JSON.parse((await h.hook({ hook_event_name: "Stop", cwd: tmpdir() }))!).systemMessage).toContain("workspace changed");
			expect(await h.stop()).toBeNull();
		} finally { h.dispose(); }
	});

	test("SessionEnd removes continuation without settling Kernel authority", async () => {
		const h = fixture(); try {
			await h.enter(); await h.hook({ hook_event_name: "SessionEnd" }); expect(await h.stop()).toBeNull();
		} finally { h.dispose(); }
	});
});
