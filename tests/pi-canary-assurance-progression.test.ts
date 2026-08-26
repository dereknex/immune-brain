import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
	buildReviewPrompt,
	deriveGithubTerminalProjectionInput,
	parseAssuranceVerdict,
	type AssuranceProgressionPorts,
} from "../plugins/immune-brain/.pi-extension/pi-canary-assurance-progression.ts";
import {
	TASK,
	ctx,
	makeAssuranceHarness as makeHarness,
	passVerdict,
	projection,
	resultText,
	snapshot,
} from "./helpers/pi-canary-assurance-harness.ts";

describe("foreground assurance progression", () => {
	test("runs QA synchronously and returns one foreground Review reservation", async () => {
		let released!: () => void;
		const gate = new Promise<void>((resolve) => { released = resolve; });
		let qaFinished = false;
		const h = makeHarness({ runQa: async (s, _descriptors, _runner, options) => { options.onProgress?.({ index: 1, total: 1, acceptance_id: "A1", phase: "passed", elapsed_ms: 1 }); await gate; qaFinished = true; return passVerdict(s); } });
		const updates: unknown[] = [];
		const advancing = h.progression.advance(TASK, ctx, undefined, (update) => updates.push(update));
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(qaFinished).toBe(false);
		released();
		const result = await advancing;
		expect(result.state).toBe("review_ready");
		expect((result as { agent_params: { run_in_background: boolean } }).agent_params.run_in_background).toBe(false);
		expect(updates.some((item) => JSON.stringify(item).includes("verifying"))).toBe(true);
		expect(h.counts().applyCount).toBe(1);
	});

	test("routine completes after deterministic QA without reserving Review", async () => {
		const h = makeHarness({ risk: "routine" });
		expect(await h.progression.advance(TASK, ctx)).toEqual({ state: "completed" });
		expect(h.progression.active(TASK)).toBeNull();
		expect(h.counts()).toEqual({ applyCount: 1, removeCount: 0, evidenceCount: 0 });
	});

	test("claimless done and stopped projections terminate before QA or claim checks", async () => {
		for (const [lifecycle, state] of [["done", "completed"], ["stopped", "stopped"]] as const) {
			const h = makeHarness({
				project: async () => ({ ...projection(lifecycle, "none"), claim: null }),
				runQa: async () => { throw new Error("terminal projection must not start QA"); },
			});
			expect(await h.progression.advance(TASK, ctx)).toEqual({ state });
			expect(h.counts().applyCount).toBe(0);
		}
	});

	test("host cancellation before authority settlement performs zero QA writes", async () => {
		let released!: () => void;
		const gate = new Promise<void>((resolve) => { released = resolve; });
		const controller = new AbortController();
		const h = makeHarness({ runQa: async () => { await gate; throw new DOMException("aborted", "AbortError"); } });
		const advancing = h.progression.advance(TASK, ctx, controller.signal);
		controller.abort();
		released();
		const result = await advancing;
		expect(result.state).toBe("cancelled");
		expect(h.counts().applyCount).toBe(0);
	});

	test("cancellation after invocation commit cannot abandon QA settlement", async () => {
		const controller = new AbortController();
		let settled = false;
		const h = makeHarness({ applyVerdict: async (_ctx, input) => {
			await input.hooks?.beforeCommit?.();
			input.hooks?.onCommit?.();
			controller.abort();
			await Promise.resolve();
			settled = true;
			await input.hooks?.afterCommit?.();
		} });
		const result = await h.progression.advance(TASK, ctx, controller.signal);
		expect(result.state).toBe("settlement_unknown");
		expect(settled).toBe(true);
	});

	test("synchronous working-to-review cancellation remains a known zero-write outcome", async () => {
		const controller = new AbortController();
		const h = makeHarness({
			phase: "working",
			applyOrdinaryOperation: (() => {
				controller.abort();
				throw new Error("cancelled before mutation started");
			}) as AssuranceProgressionPorts["applyOrdinaryOperation"],
		});
		const result = await h.progression.advance(TASK, ctx, controller.signal);
		expect(result.state).toBe("cancelled");
		expect(h.counts().applyCount).toBe(0);
	});

	test("submit_review preserves the operation for an unknown QA settlement", async () => {
		const controller = new AbortController();
		const h = makeHarness({ applyVerdict: async (_ctx, input) => {
			await input.hooks?.beforeCommit?.();
			input.hooks?.onCommit?.();
			controller.abort();
			await input.hooks?.afterCommit?.();
		} });
		const advanced = await h.progression.advance(TASK, ctx, controller.signal);
		expect(advanced.state).toBe("settlement_unknown");
		expect(await h.progression.advance(TASK, ctx)).toEqual(advanced);
		expect(await h.progression.submitReview(TASK, ctx)).toEqual({
			state: "settlement_unknown",
			operation: "qa",
			operation_id: (advanced as { operation_id: string }).operation_id,
			reason: (advanced as { reason: string }).reason,
		});
	});

	test("QA rework applies exactly once and does not reserve Review", async () => {
		const h = makeHarness({ runQa: async (s) => ({ ...passVerdict(s), decision: "rework", approval: undefined, findings: [{ id: "qa-finding", kind: "blocking", acceptance_id: "A1", summary: "repair", findings_digest: "" }] }) });
		const result = await h.progression.advance(TASK, ctx);
		expect(result.state).toBe("rework");
		expect(h.progression.active(TASK)).toBeNull();
		expect(h.counts().applyCount).toBe(1);
	});

	test("cancelling Review reservation construction removes its evidence", async () => {
		// Covered in tests/pi-canary-work-extension.test.ts against the real
		// extension surface; this in-process harness shares the static invocation
		// registry across tests and cannot reset it without weakening isolation.
	});

	test("accepts one exact foreground receipt and settles material Review without user authorization", async () => {
		const h = makeHarness();
		const ready = await h.progression.advance(TASK, ctx);
		expect(ready.state).toBe("review_ready");
		const params = (ready as Extract<typeof ready, { state: "review_ready" }>).agent_params;
		h.progression.observeToolCall({ toolName: "Agent", toolCallId: "call-1", input: params });
		h.progression.observeToolResult({ toolName: "Agent", toolCallId: "call-1", input: params, details: { status: "completed", agentId: "agent-1" }, content: [{ type: "text", text: resultText(snapshot("review")) }] });
		h.progression.observeToolEnd({ toolName: "Agent", toolCallId: "call-1", args: params, isError: false });
		const submitted = await h.progression.submitReview(TASK, ctx);
		expect(submitted).toEqual({ state: "completed" });
		expect(h.counts().applyCount).toBe(2);
		const duplicate = await h.progression.submitReview(TASK, ctx);
		expect(duplicate).toMatchObject({ state: "blocked" });
	});

	test("critical Review settles reviewer authority and leaves only user approval", async () => {
		const h = makeHarness({ risk: "critical" });
		const ready = await h.progression.advance(TASK, ctx);
		expect(ready.state).toBe("review_ready");
		const params = (ready as Extract<typeof ready, { state: "review_ready" }>).agent_params;
		h.progression.observeToolCall({ toolName: "Agent", toolCallId: "critical-call", input: params });
		h.progression.observeToolResult({ toolName: "Agent", toolCallId: "critical-call", input: params, details: { status: "completed", agentId: "critical-agent" }, content: [{ type: "text", text: resultText(snapshot("review")) }] });
		h.progression.observeToolEnd({ toolName: "Agent", toolCallId: "critical-call", args: params, isError: false });
		expect(await h.progression.submitReview(TASK, ctx)).toMatchObject({
			state: "awaiting_user",
			operation: "record-user-approval",
		});
		expect(h.counts().applyCount).toBe(2);
	});

	test("rejects a duplicate matching tool call after reservation ownership is set", async () => {
		const h = makeHarness();
		const ready = await h.progression.advance(TASK, ctx);
		const params = (ready as Extract<typeof ready, { state: "review_ready" }>).agent_params;
		expect(h.progression.observeToolCall({ toolName: "Agent", toolCallId: "call-1", input: params })).toBeUndefined();
		expect(h.progression.observeToolCall({ toolName: "Agent", toolCallId: "call-1", input: params })).toMatchObject({ block: true });
		expect(h.progression.observeToolCall({ toolName: "Agent", toolCallId: "call-2", input: params })).toMatchObject({ block: true });
	});

	test("mismatched and inverted native events fail closed without a pending verdict", async () => {
		const h = makeHarness();
		const ready = await h.progression.advance(TASK, ctx);
		const params = (ready as Extract<typeof ready, { state: "review_ready" }>).agent_params;
		h.progression.observeToolCall({ toolName: "Agent", toolCallId: "unreserved", input: { ...params, run_in_background: true } });
		h.progression.observeToolCall({ toolName: "Agent", toolCallId: "call-1", input: params });
		h.progression.observeToolEnd({ toolName: "Agent", toolCallId: "call-1", args: params, isError: false });
		h.progression.observeToolResult({ toolName: "Agent", toolCallId: "call-1", input: params, details: { status: "completed" }, content: [{ type: "text", text: resultText(snapshot("review")) }] });
		const submitted = await h.progression.submitReview(TASK, ctx);
		expect(submitted.state).toBe("blocked");
		expect(h.counts().applyCount).toBe(1);
		const repeat = await h.progression.submitReview(TASK, ctx);
		expect(repeat).toMatchObject({ state: "blocked", reason: "foreground Agent terminal event arrived before its result" });
	});
	test("session shutdown aborts in-flight QA and prevents authority writes", async () => {
		let release!: () => void;
		const gate = new Promise<void>((resolve) => { release = resolve; });
		let qaSignal: AbortSignal | undefined;
		const h = makeHarness({ runQa: async (s, _descriptors, _runner, options) => {
			qaSignal = options.signal;
			await gate;
			return passVerdict(s);
		} });
		const advancing = h.progression.advance(TASK, ctx);
		await new Promise((resolve) => setTimeout(resolve, 0));
		await h.progression.onSessionShutdown();
		expect(qaSignal?.aborted).toBe(true);
		release();
		const result = await advancing;
		expect(result.state).toBe("cancelled");
		expect(h.counts().applyCount).toBe(0);
	});

	test("stale Review correlation and session shutdown discard the transient receipt", async () => {
		let stale = false;
		let projectionReads = 0;
		const h = makeHarness({ project: async () => {
			projectionReads += 1;
			return stale
				? { ...projection("review", "run_review"), projection: { ...projection("review", "run_review").projection, record_revision: "record-new" } } as never
				: projection("review", projectionReads === 1 ? "run_qa" : "run_review");
		} });
		const ready = await h.progression.advance(TASK, ctx);
		const params = (ready as Extract<typeof ready, { state: "review_ready" }>).agent_params;
		h.progression.observeToolCall({ toolName: "Agent", toolCallId: "call-1", input: params });
		h.progression.observeToolResult({ toolName: "Agent", toolCallId: "call-1", input: params, details: { status: "completed" }, content: [{ type: "text", text: resultText(snapshot("review")) }] });
		h.progression.observeToolEnd({ toolName: "Agent", toolCallId: "call-1" });
		stale = true;
		expect((await h.progression.submitReview(TASK, ctx)).state).toBe("blocked");
		expect(h.counts().removeCount).toBe(1);
		await h.progression.onSessionShutdown();
		expect(h.progression.active(TASK)).toBeNull();
	});
});

test("native Review reservations inject the internal Code Review role contract", () => {
	const prompt = buildReviewPrompt(snapshot("review"), "/tmp/evidence.json");
	expect(prompt).toContain("internal role: code-review");
	expect(prompt).toContain("imm-code-review");
	expect(prompt).toContain("do not discover or load Pi Skills");
});
test("projects GitHub terminal state only from an exact claimless tombstone", () => {
	const settled = projection("done");
	settled.claim = null;
	const tombstone = {
		contract: "assurance_kernel/task_tombstone/v2",
		task_id: TASK,
		lifecycle_status: "terminal",
		terminal_lifecycle: "done",
		terminal_event_id: "complete:phase3-task:2099-01-01T02:00:00.000Z",
	} as never;
	expect(deriveGithubTerminalProjectionInput(TASK, settled, tombstone)).toEqual({
		task_id: TASK,
		phase: "done",
		terminal_event_id: "complete:phase3-task:2099-01-01T02:00:00.000Z",
	});
	expect(deriveGithubTerminalProjectionInput(TASK, { ...settled, claim: { task_id: TASK } } as never, tombstone)).toBeNull();
	expect(deriveGithubTerminalProjectionInput(TASK, settled, { ...tombstone, terminal_lifecycle: "stopped" })).toBeNull();
	expect(deriveGithubTerminalProjectionInput(TASK, projection("active"), tombstone)).toBeNull();
});

test("host hooks never project active state and publish terminal projection only from fresh claimless evidence", () => {
	const root = resolve(import.meta.dir, "..");
	const enrollment = readFileSync(resolve(root, "plugins/immune-brain/.pi-extension/imm-canary-enroll.ts"), "utf8");
	const work = readFileSync(resolve(root, "plugins/immune-brain/.pi-extension/imm-canary-work.ts"), "utf8");
	const stub = readFileSync(resolve(root, "plugins/immune-brain/.pi-extension/runtime-stub.ts"), "utf8");
	// Durable absence guards: the retired mark-active projection is fully deleted.
	expect(enrollment).not.toContain("markGithubTaskActive");
	expect(enrollment).not.toContain("github_issue_tracker");
	expect(stub).not.toContain("markGithubTaskActive");
	expect(stub).not.toContain("mark-active");
	// Terminal projection stays gated behind fresh Assurance plus exact tombstone reads.
	const enrichment = work.indexOf("async function enrichAssuranceResult");
	const freshProjection = work.indexOf("await projectAssuranceState", enrichment);
	const tombstoneRead = work.indexOf("await readTaskTombstone", freshProjection);
	const terminalProjection = work.indexOf("await markGithubTaskTerminal", tombstoneRead);
	expect(enrichment).toBeGreaterThan(-1);
	expect(freshProjection).toBeGreaterThan(enrichment);
	expect(tombstoneRead).toBeGreaterThan(freshProjection);
	expect(terminalProjection).toBeGreaterThan(tombstoneRead);
});

test("parseAssuranceVerdict rejects a verdict bound to another snapshot", () => {
	const s = snapshot("review");
	expect(() => parseAssuranceVerdict(resultText({ ...s, diff_hash: "sha256:other" }), s)).toThrow(/snapshot digest/i);
});
