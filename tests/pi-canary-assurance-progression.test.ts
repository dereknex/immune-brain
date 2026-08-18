import { describe, expect, test } from "bun:test";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	AssuranceProgression,
	parseAssuranceVerdict,
	snapshotDigest,
	type AssuranceProgressionPorts,
	type AssuranceVerdict,
	type SnapshotDescriptor,
} from "../plugins/immune-brain/.pi-extension/pi-canary-assurance-progression.ts";
import type { AssuranceProjectionResult } from "../plugins/immune-brain/.pi-extension/runtime-stub.ts";
import type { ReviewBundle } from "../plugins/immune-brain/.pi-extension/pi-canary-review-bundle.ts";

const TASK = "phase3-task";
const ROOT = "/tmp/phase3-assurance";
const ctx = { cwd: ROOT, mode: "tui", ui: {} } as unknown as ExtensionContext;

function projection(phase: string = "review"): AssuranceProjectionResult {
	return {
		error: null,
		claim: { task_id: TASK, lifecycle_status: "working" } as never,
		projection: {
			phase,
			record_revision: "record-1",
			workspace_revision: "workspace-1",
			intent_revision: 1,
			intent_content_hash: "sha256:intent",
			diff_hash: "sha256:diff",
			fresh_acceptance_ids: ["A1"],
			missing_acceptance_ids: [],
			stale_evidence_ids: [],
			blocking_finding_ids: [],
			unresolved_user_decision_ids: [],
			replan_required_ids: [],
			completion_ready: false,
			authorization: { state: "blocked" },
		} as never,
	} as AssuranceProjectionResult;
}

function snapshot(role: "qa" | "review"): SnapshotDescriptor {
	return {
		contract: "assurance_kernel/assurance_snapshot/v1",
		task_id: TASK,
		role,
		record_revision: "record-1",
		workspace_revision: "workspace-1",
		intent_revision: 1,
		intent_content_hash: "sha256:intent",
		diff_hash: "sha256:diff",
		phase: "review",
		risk: "material",
		fresh_acceptance_ids: ["A1"],
		missing_acceptance_ids: [],
		stale_evidence_ids: [],
		acceptance: [{ id: "A1", assertion: "the contract holds", verification: "{}" }],
		dirty_files: ["src/change.ts"],
		review_bundle_digest: role === "review" ? "sha256:bundle" : null,
		root: ROOT,
	};
}

function reviewBundle(): ReviewBundle {
	return {
		contract: "assurance_kernel/review_bundle/v4",
		root: ROOT,
		head: "a".repeat(40),
		scope: ["src/change.ts"],
		diff_hash: "sha256:diff",
		dirty_files: {},
		outcomes: { A1: { status: "passed", summary: "fresh" } },
		bundle_digest: "sha256:bundle",
	} as unknown as ReviewBundle;
}

function passVerdict(s: SnapshotDescriptor): AssuranceVerdict {
	return {
		contract: "assurance_kernel/assurance_verdict/v2",
		role: s.role,
		task_id: TASK,
		snapshot_digest: snapshotDigest(s),
		decision: "pass",
		approval: { kind: s.role === "qa" ? "qa" : "review", authority_role: s.role === "qa" ? "qa" : "reviewer", summary: "passed" },
	};
}

function makeHarness(overrides: Partial<{
	phase: string;
	runQa: AssuranceProgressionPorts["runQa"];
	project: AssuranceProgressionPorts["projectTask"];
	writeReviewEvidence: AssuranceProgressionPorts["writeReviewEvidence"];
	applyVerdict: AssuranceProgressionPorts["applyVerdict"];
	applyOrdinaryOperation: AssuranceProgressionPorts["applyOrdinaryOperation"];
}> = {}) {
	let applyCount = 0;
	let removeCount = 0;
	let evidenceCount = 0;
	const ports: AssuranceProgressionPorts = {
		projectTask: overrides.project ?? (async () => projection(overrides.phase ?? "review")),
		readTaskRecordV2: async () => ({ record: { findings: [] } } as never),
		readTaskIntent: async () => ({ token: "intent-token" } as never),
		frozenRunner: async () => ({ id: "bun", version: "1.3.14" } as never),
		buildAssurance: async (_root, _task, role) => ({
			snapshot: snapshot(role),
			descriptors: new Map([[
				"A1",
				{ contract: "assurance_kernel/verification_descriptor/v1", runner_id: "bun", runner_version: "1.3.14", argv: ["test"], cwd: ".", timeout_ms: 1000, max_output_bytes: 1024 },
			]] as never),
			reviewBundle: role === "review" ? reviewBundle() : null,
		}),
		runQa: overrides.runQa ?? (async (s, _descriptors, _runner, options) => {
			options.onProgress?.({ index: 1, total: 1, acceptance_id: "A1", phase: "passed", elapsed_ms: 1 });
			return passVerdict(s);
		}),
		writeReviewEvidence: overrides.writeReviewEvidence ?? (() => {
			evidenceCount += 1;
			return { path: `${ROOT}/review-${evidenceCount}.json`, remove: () => { removeCount += 1; } };
		}),
		applyVerdict: overrides.applyVerdict ?? (async (_ctx, input) => {
			applyCount += 1;
			await input.hooks?.beforeCommit?.();
			input.hooks?.onCommit?.();
			await input.hooks?.afterCommit?.();
		}),
		applyOrdinaryOperation: overrides.applyOrdinaryOperation ?? (async () => undefined),
	};
	return { progression: new AssuranceProgression(ports), ports, counts: () => ({ applyCount, removeCount, evidenceCount }) };
}

function resultText(s: SnapshotDescriptor, decision: "pass" | "rework" = "pass"): string {
	return JSON.stringify(decision === "pass"
		? passVerdict(s)
		: { contract: "assurance_kernel/assurance_verdict/v2", role: "review", task_id: TASK, snapshot_digest: snapshotDigest(s), decision: "rework", findings: [{ id: "finding", kind: "blocking", acceptance_id: "A1", summary: "needs repair" }] });
}

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

	test("accepts one exact foreground receipt and leaves authority to request_authorization", async () => {
		const h = makeHarness();
		const ready = await h.progression.advance(TASK, ctx);
		expect(ready.state).toBe("review_ready");
		const params = (ready as Extract<typeof ready, { state: "review_ready" }>).agent_params;
		h.progression.observeToolCall({ toolName: "Agent", toolCallId: "call-1", input: params });
		h.progression.observeToolResult({ toolName: "Agent", toolCallId: "call-1", input: params, details: { status: "completed", agentId: "agent-1" }, content: [{ type: "text", text: resultText(snapshot("review")) }] });
		h.progression.observeToolEnd({ toolName: "Agent", toolCallId: "call-1", args: params, isError: false });
		const submitted = await h.progression.submitReview(TASK, ctx);
		expect(submitted).toMatchObject({ state: "awaiting_user", operation: "record-review-verdict" });
		expect(h.progression.hasPendingReviewVerdict(TASK)).toBe(true);
		expect(h.counts().applyCount).toBe(1);
		const duplicate = await h.progression.submitReview(TASK, ctx);
		expect(duplicate).toMatchObject({ state: "awaiting_user" });
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
		expect(h.progression.hasPendingReviewVerdict(TASK)).toBe(false);
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
		const h = makeHarness({ project: async () => stale ? { ...projection(), projection: { ...projection().projection, record_revision: "record-new" } } as never : projection() });
		const ready = await h.progression.advance(TASK, ctx);
		const params = (ready as Extract<typeof ready, { state: "review_ready" }>).agent_params;
		h.progression.observeToolCall({ toolName: "Agent", toolCallId: "call-1", input: params });
		h.progression.observeToolResult({ toolName: "Agent", toolCallId: "call-1", input: params, details: { status: "completed" }, content: [{ type: "text", text: resultText(snapshot("review")) }] });
		h.progression.observeToolEnd({ toolName: "Agent", toolCallId: "call-1" });
		stale = true;
		expect((await h.progression.submitReview(TASK, ctx)).state).toBe("blocked");
		expect(h.progression.hasPendingReviewVerdict(TASK)).toBe(false);
		expect(h.counts().removeCount).toBe(1);
		await h.progression.onSessionShutdown();
		expect(h.progression.active(TASK)).toBeNull();
	});
});

test("parseAssuranceVerdict rejects a verdict bound to another snapshot", () => {
	const s = snapshot("review");
	expect(() => parseAssuranceVerdict(resultText({ ...s, diff_hash: "sha256:other" }), s)).toThrow(/snapshot digest/i);
});
