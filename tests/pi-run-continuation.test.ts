import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerPiRunContinuation } from "../plugins/immune-brain/.pi-extension/pi-run-continuation";
import { canonicalIntentHash, parseTaskIntentV1 } from "../plugins/immune-brain/runtime/kernel/intent";
import { recognizePhaseEntry } from "../plugins/immune-brain/runtime/assurance/phase_entry";
import { seedKernelRunForTest } from "./fixtures/mutation-authority-test-seam";

function fixture() {
	const root = mkdtempSync(join(tmpdir(), "gdr-pi-"));
	const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
	git("init", "-q"); git("config", "user.name", "Fixture"); git("config", "user.email", "fixture@example.test");
	mkdirSync(join(root, "docs/plans"), { recursive: true });
	writeFileSync(join(root, ".gitignore"), ".imm/\n"); writeFileSync(join(root, "value.txt"), "before\n");
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
	const handlers = new Map<string, Function>();
	const ctx = { cwd: root, sessionManager: { getSessionId: () => "session-a", getLeafId: () => `leaf-${boundary}` } };
	let boundary = 0;
	// The sessions whose entry token the boundary ended (ADR 0025).
	const revoked: string[] = [];
	registerPiRunContinuation({ on: (event: string, callback: Function) => handlers.set(event, callback) } as any,
		{ entry: (text) => recognizePhaseEntry(text, () => null), revokeEntry: (sessionId) => revoked.push(sessionId) });
	const emit = (name: string, event: unknown) => handlers.get(name)?.(event, ctx);
	const enter = async () => {
		await emit("input", { text: "/imm-run", source: "interactive" });
		await emit("tool_call", { toolName: "imm_kernel_canary", toolCallId: "status-1", input: { task_id: "slice-a", action: { op: "status" } } });
		await emit("tool_result", { toolName: "imm_kernel_canary", toolCallId: "status-1", isError: false, details: {} });
	};
	const settle = () => { boundary++; return emit("agent_before_settle", { outcome: "completed", continue: false,
		context: { canContinue: true, pendingMessages: [] } }); };
	return { root, ctx, emit, enter, settle, revoked, dispose: () => rmSync(root, { recursive: true, force: true }) };
}

describe("Pi run continuation boundary", () => {
	test("an active task never resumes without a literal run entry", async () => {
		const h = fixture(); try {
			await h.emit("input", { text: "How is the task?", source: "interactive" });
			expect(await h.settle()).toBeUndefined();
			await h.enter();
			expect(await h.settle()).toMatchObject({ continue: true });
			await h.emit("input", { text: "What remains?", source: "interactive" });
			writeFileSync(join(h.root, "value.txt"), "edited\n");
			expect(await h.settle()).toMatchObject({ continue: true });
		} finally { h.dispose(); }
	});

	test("ordinary source progress resets stalls; repeated status does not", async () => {
		const h = fixture(); try {
			await h.enter(); expect(await h.settle()).toMatchObject({ continue: true });
			writeFileSync(join(h.root, "value.txt"), "after\n");
			expect(await h.settle()).toMatchObject({ continue: true });
			expect(await h.settle()).toMatchObject({ entries: [{ customType: "immune-brain-run-paused", display: true }] });
			expect(await h.settle()).toBeUndefined();
		} finally { h.dispose(); }
	});

	test.each(["取消任务", "/imm-planner", "/imm-brainstorm"])("%s releases continuation without mutating authority", async (prompt) => {
		const h = fixture(); try {
			await h.enter(); await h.emit("input", { text: prompt, source: "interactive" });
			expect(await h.settle()).toBeUndefined();
		} finally { h.dispose(); }
	});

	test("an aborted turn and session shutdown cannot auto-resume", async () => {
		const h = fixture(); try {
			await h.enter();
			await h.emit("agent_before_settle", { outcome: "aborted", continue: false, context: { canContinue: false, pendingMessages: [] } });
			expect(await h.settle()).toBeUndefined();
			await h.enter(); await h.emit("session_shutdown", {});
			expect(await h.settle()).toBeUndefined();
		} finally { h.dispose(); }
	});

	test("changed prompts, background dispatch and duplicate Review are blocked before execution", async () => {
		const h = fixture(); try {
			await h.enter();
			await h.emit("tool_call", { toolName: "imm_kernel_canary", toolCallId: "qa", input: { task_id: "slice-a", action: { op: "advance_assurance" } } });
			await h.emit("tool_result", { toolName: "imm_kernel_canary", toolCallId: "qa", isError: false,
				details: { state: "review_ready", agent_params: { prompt: "exact reserved prompt\n" } } });
			const dispatch = (prompt: string, background: boolean, id: string) => h.emit("tool_call", { toolName: "Agent", toolCallId: id,
				input: { prompt, subagent_type: "Review", run_in_background: background } });
			expect(await dispatch("rewritten", false, "wrong")).toMatchObject({ block: true });
			expect(await dispatch("exact reserved prompt\n", true, "background")).toMatchObject({ block: true });
			expect(await dispatch("exact reserved prompt\n", false, "exact")).toBeUndefined();
			expect(await dispatch("exact reserved prompt\n", false, "duplicate")).toMatchObject({ block: true });
		} finally { h.dispose(); }
	});

	test.each([
		["imm_canary_enrollment", undefined], ["imm_kernel_canary", "request_authorization"],
		["imm_kernel_canary", "approve_breaking_intent_revision"], ["imm_kernel_canary", "request_stop"],
	])("%s %s failure suppresses gate retries before and after settle until explicit entry", async (name, op) => {
		const h = fixture(); try {
			await h.enter();
			const call = (id: string) => ({ toolName: name, toolCallId: id, input: { task_id: "slice-a", action: { op } } });
			await h.emit("tool_call", call("gate"));
			await h.emit("tool_result", { toolName: name, toolCallId: "gate", isError: true, details: { reason: "cancelled" } });
			expect(await h.emit("tool_call", call("retry-before"))).toMatchObject({ block: true });
			expect(await h.settle()).toMatchObject({ entries: [{ customType: "immune-brain-run-paused" }] });
			expect(await h.emit("tool_call", call("retry-after"))).toMatchObject({ block: true });
			await h.emit("input", { text: "What remains?", source: "interactive" });
			expect(await h.emit("tool_call", call("ordinary-input"))).toMatchObject({ block: true });
			await h.enter(); expect(await h.emit("tool_call", call("new-entry"))).toBeUndefined();
		} finally { h.dispose(); }
	});

	test("native failure pauses once; no automatic gate retry", async () => {
		const h = fixture(); try {
			await h.enter();
			await h.emit("tool_call", { toolName: "imm_kernel_canary", toolCallId: "gate", input: { task_id: "slice-a", action: { op: "request_authorization" } } });
			await h.emit("tool_result", { toolName: "imm_kernel_canary", toolCallId: "gate", isError: true, details: { reason: "cancelled" } });
			expect(await h.settle()).toMatchObject({ entries: [{ customType: "immune-brain-run-paused" }] });
			expect(await h.settle()).toBeUndefined();
		} finally { h.dispose(); }
	});
	test("a pause ends the session's entry token; a continuing run keeps it", async () => {
		const h = fixture(); try {
			await h.enter();
			expect(await h.settle()).toMatchObject({ continue: true });
			expect(h.revoked).toEqual([]);
			await h.emit("tool_call", { toolName: "imm_kernel_canary", toolCallId: "gate", input: { task_id: "slice-a", action: { op: "request_authorization" } } });
			await h.emit("tool_result", { toolName: "imm_kernel_canary", toolCallId: "gate", isError: true, details: { reason: "cancelled" } });
			expect(await h.settle()).toMatchObject({ entries: [{ customType: "immune-brain-run-paused" }] });
			expect(h.revoked).toEqual(["session-a"]);
		} finally { h.dispose(); }
	});
});
