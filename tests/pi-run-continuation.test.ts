import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerPiRunContinuation } from "../plugins/immune-brain/.pi-extension/pi-run-continuation";
import { recordPiPhaseInput, piEntryToken, revokePiPhaseEntry } from "../plugins/immune-brain/.pi-extension/imm-canary-work";
import { canonicalIntentHash, parseTaskIntentV1 } from "../plugins/immune-brain/runtime/kernel/intent";
import { recognizePhaseEntry, NO_LOCAL_NAMES } from "../plugins/immune-brain/runtime/assurance/phase_entry";
import { sessionHash } from "../plugins/immune-brain/runtime/host-core/private_file";
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
	const handlers = new Map<string, Function[]>();
	const on = (event: string, callback: Function) => {
		const list = handlers.get(event) ?? [];
		list.push(callback);
		handlers.set(event, list);
	};
	const ctx = { cwd: root, sessionManager: { getSessionId: () => "session-a", getLeafId: () => `leaf-${boundary}` } };
	let boundary = 0;
	// The sessions whose entry token the boundary ended (ADR 0025).
	const revoked: string[] = [];
	// Canary input handler runs first in real Pi (imm-canary-work.ts:769)
	on("input", async (event: any, c: any) => {
		if (event.source === "extension") return { action: "continue" } as const;
		recordPiPhaseInput(event, c);
		return { action: "continue" } as const;
	});
	registerPiRunContinuation({ on } as any,
		{
			entry: (text) => recognizePhaseEntry(text, NO_LOCAL_NAMES, "pi"),
			revokeEntry: (sessionId) => {
				revoked.push(sessionId);
				revokePiPhaseEntry(sessionId);
			},
		},
		{ storeRoot: root });
	const emit = async (name: string, event: unknown) => {
		const list = handlers.get(name) ?? [];
		let lastResult: unknown;
		for (const cb of list) {
			const res = await cb(event, ctx);
			if (res !== undefined) lastResult = res;
		}
		return lastResult;
	};
	const enter = async () => {
		await emit("input", { text: "/drive", source: "interactive" });
		await emit("tool_call", { toolName: "imm_kernel_canary", toolCallId: "status-1", input: { task_id: "slice-a", action: { op: "status" } } });
		await emit("tool_result", { toolName: "imm_kernel_canary", toolCallId: "status-1", isError: false, details: {} });
	};
	const settle = () => { boundary++; return emit("agent_before_settle", { outcome: "completed", continue: false,
		context: { canContinue: true, pendingMessages: [] } }); };
	return { root, ctx, emit, enter, settle, revoked, dispose: () => {
		revokePiPhaseEntry("session-a");
		rmSync(root, { recursive: true, force: true });
	} };
}

describe("Pi run continuation boundary", () => {
	test("incomplete retries one new reservation, then pauses the run without a native gate", async () => {
		const h = fixture(); try {
			await h.enter();
			const result = async (op: string, details: object, id: string) => {
				await h.emit("tool_call", { toolName: "imm_kernel_canary", toolCallId: id, input: { task_id: "slice-a", action: { op } } });
				await h.emit("tool_result", { toolName: "imm_kernel_canary", toolCallId: id, isError: false, details });
			};
			await result("advance_assurance", { state: "review_ready", agent_params: { prompt: "first prompt" } }, "advance-1");
			const agent = (prompt: string, id: string) => h.emit("tool_call", { toolName: "Agent", toolCallId: id, input: { prompt, subagent_type: "Review", run_in_background: false } });
			expect(await agent("first prompt", "review-1")).toBeUndefined();
			await result("submit_review", { state: "blocked", reason: "review_incomplete_retry", recovery_action: "advance_assurance" }, "submit-1");
			await result("advance_assurance", { state: "review_ready", agent_params: { prompt: "second prompt" } }, "advance-2");
			expect(await agent("second prompt", "review-2")).toBeUndefined();
			await result("submit_review", { state: "review_incomplete", reason: "unfinished", recovery_action: "reduce scope and enter drive" }, "submit-2");
			expect(await h.settle()).toMatchObject({ entries: [{ customType: "immune-brain-run-paused" }] });
			expect(h.revoked).toEqual(["session-a"]);
			expect(await h.settle()).toBeUndefined();
		} finally { h.dispose(); }
	});
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

	test("an unchanged digest yields without pausing or revoking the entry; progress continues again (D12)", async () => {
		const h = fixture(); try {
			await h.enter(); expect(await h.settle()).toMatchObject({ continue: true });
			// Unchanged digest: yields the turn quietly without pausing or spending the entry token
			expect(await h.settle()).toBeUndefined();
			expect(h.revoked).toEqual([]);
			// Later progress continues again
			writeFileSync(join(h.root, "value.txt"), "after\n");
			expect(await h.settle()).toMatchObject({ continue: true });
			expect(await h.settle()).toBeUndefined();
			expect(h.revoked).toEqual([]);
		} finally { h.dispose(); }
	});

	test.each(["取消任务", "/draw-up", "/clarify"])("%s releases continuation without mutating authority", async (prompt) => {
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
		["imm_kernel_canary", "request_authorization"],
		["imm_kernel_canary", "approve_breaking_intent_revision"], ["imm_kernel_canary", "request_stop"],
	])("%s %s: two failures stay retryable, the third suppresses gate retries until explicit entry (D9)", async (name, op) => {
		const h = fixture(); try {
			await h.enter();
			const call = (id: string) => ({ toolName: name, toolCallId: id, input: { task_id: "slice-a", action: { op } } });
			const fail = async (id: string) => {
				expect(await h.emit("tool_call", call(id))).toBeUndefined();
				await h.emit("tool_result", { toolName: name, toolCallId: id, isError: true, details: { reason: "rejected" } });
			};
			await fail("gate-1"); await fail("gate-2");
			expect(await h.settle()).toMatchObject({ continue: true });
			await fail("gate-3");
			expect(await h.emit("tool_call", call("retry-before"))).toMatchObject({ block: true });
			expect(await h.settle()).toMatchObject({ entries: [{ customType: "immune-brain-run-paused" }] });
			expect(await h.emit("tool_call", call("retry-after"))).toMatchObject({ block: true });
			await h.emit("input", { text: "What remains?", source: "interactive" });
			expect(await h.emit("tool_call", call("ordinary-input"))).toMatchObject({ block: true });
			await h.enter(); await fail("new-entry-1"); await fail("new-entry-2");
			expect(await h.emit("tool_call", call("new-entry-3"))).toBeUndefined();
		} finally { h.dispose(); }
	});

	test("native failures pause once at the third; no automatic gate retry", async () => {
		const h = fixture(); try {
			await h.enter();
			for (const id of ["gate-1", "gate-2", "gate-3"]) {
				await h.emit("tool_call", { toolName: "imm_kernel_canary", toolCallId: id, input: { task_id: "slice-a", action: { op: "request_authorization" } } });
				await h.emit("tool_result", { toolName: "imm_kernel_canary", toolCallId: id, isError: true, details: { reason: "cancelled" } });
			}
			expect(await h.settle()).toMatchObject({ entries: [{ customType: "immune-brain-run-paused" }] });
			expect(await h.settle()).toBeUndefined();
		} finally { h.dispose(); }
	});

	test.each([["aborted", false], ["aborted", true], ["completed", false]] as const)(
		"a %s turn with canContinue %p revokes the live entry token (AC4)", async (outcome, canContinue) => {
		const h = fixture(); try {
			await h.enter();
			await h.emit("agent_before_settle", { outcome, continue: false, context: { canContinue, pendingMessages: [] } });
			expect(h.revoked).toEqual(["session-a"]);
		} finally { h.dispose(); }
	});

	test("a pause ends the session's entry token; a continuing run keeps it", async () => {
		const h = fixture(); try {
			await h.enter();
			expect(await h.settle()).toMatchObject({ continue: true });
			expect(h.revoked).toEqual([]);
			for (const id of ["gate-1", "gate-2", "gate-3"]) {
				await h.emit("tool_call", { toolName: "imm_kernel_canary", toolCallId: id, input: { task_id: "slice-a", action: { op: "request_authorization" } } });
				await h.emit("tool_result", { toolName: "imm_kernel_canary", toolCallId: id, isError: true, details: { reason: "cancelled" } });
			}
			expect(await h.settle()).toMatchObject({ entries: [{ customType: "immune-brain-run-paused" }] });
			expect(h.revoked).toEqual(["session-a"]);
		} finally { h.dispose(); }
	});

	test("pauses on the seventh consecutive settle boundary with progress and tells user to resume explicitly in the same Host (D6)", async () => {
		const h = fixture(); try {
			await h.enter();
			for (let attempt = 1; attempt <= 6; attempt++) {
				writeFileSync(join(h.root, "value.txt"), `progress ${attempt}\n`);
				expect(await h.settle()).toMatchObject({ continue: true });
			}
			writeFileSync(join(h.root, "value.txt"), "progress 7\n");
			const seventh = await h.settle();
			expect(seventh).toMatchObject({
				entries: [{
					customType: "immune-brain-run-paused",
					content: expect.stringContaining("Pi consecutive Stop boundary reached; resume explicitly in the same Host"),
				}],
			});
			expect(h.revoked).toEqual(["session-a"]);
			expect(await h.settle()).toBeUndefined();
		} finally { h.dispose(); }
	});

	test("session metadata past the 256 KiB bound is treated as blank (D9)", async () => {
		const h = fixture(); try {
			await h.enter();
			expect(await h.settle()).toMatchObject({ continue: true });
			const path = join(h.root, "immune-brain-pi", `${sessionHash("session-a")}.continuation`);
			expect(existsSync(path)).toBe(true);
			const metadata = JSON.parse(readFileSync(path, "utf8").trim());
			writeFileSync(path, JSON.stringify({ ...metadata, pad: "x".repeat(256 * 1024) }) + "\n");
			expect(await h.settle()).toBeUndefined();
		} finally { h.dispose(); }
	});

	test("an interleaved user turn resets the consecutive settle boundary counter (AC2, D6)", async () => {
		const h = fixture(); try {
			await h.enter();
			// 4 automated continues
			for (let attempt = 1; attempt <= 4; attempt++) {
				writeFileSync(join(h.root, "value.txt"), `progress ${attempt}\n`);
				expect(await h.settle()).toMatchObject({ continue: true });
			}
			// User inputs an ordinary message (not a run entry or release)
			await h.emit("input", { text: "What remains?", source: "interactive" });
			// Next settle is a user turn: resets consecutive counter
			writeFileSync(join(h.root, "value.txt"), "progress after user\n");
			expect(await h.settle()).toMatchObject({ continue: true });
			// 3 more settles -> total 8 settles since entry, but only 4 consecutive since user turn
			for (let attempt = 1; attempt <= 3; attempt++) {
				writeFileSync(join(h.root, "value.txt"), `progress second batch ${attempt}\n`);
				expect(await h.settle()).toMatchObject({ continue: true });
			}
			// Does NOT pause at 7 total boundaries: only 4 consecutive since user turn
			expect(h.revoked).toEqual([]);
		} finally { h.dispose(); }
	});

	test("an unrelated Agent subagent dispatch is allowed while Review is reserved (AC1)", async () => {
		const h = fixture(); try {
			await h.enter();
			await h.emit("tool_call", { toolName: "imm_kernel_canary", toolCallId: "qa", input: { task_id: "slice-a", action: { op: "advance_assurance" } } });
			await h.emit("tool_result", { toolName: "imm_kernel_canary", toolCallId: "qa", isError: false,
				details: { state: "review_ready", agent_params: { prompt: "exact reserved prompt\n" } } });
			// Non-Review Agent dispatch with unrelated prompt and subagent_type passes through
			const otherAgent = await h.emit("tool_call", {
				toolName: "Agent",
				toolCallId: "explore-1",
				input: { prompt: "find something", subagent_type: "Explore", run_in_background: false },
			});
			expect(otherAgent).toBeUndefined();
		} finally { h.dispose(); }
	});

	test("Pi literal /drive mints in-process entry token and continuation preserves it (review-1)", async () => {
		const h = fixture(); try {
			expect(piEntryToken(h.ctx)).toBeNull();
			await h.enter();
			const token = piEntryToken(h.ctx);
			expect(token).toBeTruthy();
			expect(typeof token).toBe("string");
			// First settle continues with bound task
			expect(await h.settle()).toMatchObject({ continue: true });
			expect(piEntryToken(h.ctx)).toBe(token);
			// Unchanged settle yields turn without revoking token
			expect(await h.settle()).toBeUndefined();
			expect(piEntryToken(h.ctx)).toBe(token);
			// Releasing prompt revokes token
			await h.emit("input", { text: "/draw-up", source: "interactive" });
			expect(piEntryToken(h.ctx)).toBeNull();
		} finally { h.dispose(); }
	});

	test("Pi run pause revokes the in-process entry token", async () => {
		const h = fixture(); try {
			await h.enter();
			expect(piEntryToken(h.ctx)).toBeTruthy();
			const result = async (op: string, details: object, id: string) => {
				await h.emit("tool_call", { toolName: "imm_kernel_canary", toolCallId: id, input: { task_id: "slice-a", action: { op } } });
				await h.emit("tool_result", { toolName: "imm_kernel_canary", toolCallId: id, isError: false, details });
			};
			await result("advance_assurance", { state: "review_ready", agent_params: { prompt: "p1" } }, "adv-1");
			await h.emit("tool_call", { toolName: "Agent", toolCallId: "rev-1", input: { prompt: "p1", subagent_type: "Review", run_in_background: false } });
			await result("submit_review", { state: "blocked", reason: "review_incomplete_retry", recovery_action: "advance_assurance" }, "sub-1");
			await result("advance_assurance", { state: "review_ready", agent_params: { prompt: "p2" } }, "adv-2");
			await h.emit("tool_call", { toolName: "Agent", toolCallId: "rev-2", input: { prompt: "p2", subagent_type: "Review", run_in_background: false } });
			await result("submit_review", { state: "review_incomplete", reason: "unfinished", recovery_action: "pause" }, "sub-2");
			expect(await h.settle()).toMatchObject({ entries: [{ customType: "immune-brain-run-paused" }] });
			expect(piEntryToken(h.ctx)).toBeNull();
		} finally { h.dispose(); }
	});
});
