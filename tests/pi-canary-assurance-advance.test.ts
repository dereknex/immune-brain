import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { canonicalIntentHash } from "../plugins/immune-brain/runtime/kernel/intent";
import { enrollCanaryTask } from "../plugins/immune-brain/runtime/kernel/enrollment";
import { createEnrollmentAuthorityRegistry, type EnrollmentCapabilityBinding } from "../plugins/immune-brain/runtime/kernel/enrollment_authority";
import { preparePiCanary } from "../plugins/immune-brain/runtime/kernel/pi_canary_prepare";

const TASK = "assurance-advance-task";
const INTENT = {
	contract: "assurance_kernel/task_intent/v1",
	task_id: TASK,
	goal: "exercise agent-callable assurance advance",
	acceptance: [{
		id: "A1",
		assertion: "advance starts QA",
		verification: JSON.stringify({
			contract: "assurance_kernel/verification_descriptor/v1",
			runner_id: "bun",
			runner_version: "1.3.14",
			argv: ["test"],
			cwd: ".",
			timeout_ms: 1_000,
			max_output_bytes: 1_024,
		}),
	}],
	scope_hint: ["plugins/immune-brain/.pi-extension"],
	risk: "routine",
	revision: 1,
	owner: "user",
} as const;

function enrolledRoot(): string {
	const root = mkdtempSync(join(tmpdir(), "assurance-advance-"));
	mkdirSync(join(root, "docs", "plans"), { recursive: true });
	mkdirSync(join(root, ".imm", "tasks"), { recursive: true });
	execFileSync("git", ["init", "-q"], { cwd: root });
	writeFileSync(join(root, "docs", "plans", `${TASK}.intent.json`), `${JSON.stringify(INTENT, null, 2)}\n`);
	execFileSync("git", ["add", "-A"], { cwd: root });
	execFileSync("git", ["commit", "-qm", "intent"], { cwd: root });
	writeFileSync(join(root, ".imm", "workspace.json"), `${JSON.stringify({ contract: "assurance_kernel/workspace/v1", current_working: null }, null, 2)}\n`);
	const registry = createEnrollmentAuthorityRegistry();
	const prep = preparePiCanary(root, { task_id: TASK, now: "2026-08-14T00:00:00.000Z" });
	const binding: EnrollmentCapabilityBinding = {
		task_id: TASK,
		intent_path: `docs/plans/${TASK}.intent.json`,
		intent_revision: 1,
		intent_content_hash: canonicalIntentHash(INTENT),
		preparation_digest: prep.digest,
		readiness_digest: "sha256:ready",
		evidence_digest: "sha256:evidence",
		waiver_gate: "observation_window_days",
		actor_id: "user",
		confirmation_ref: "test",
		expires_at: "2099-01-01T00:00:00.000Z",
		nonce: "advance-test",
	};
	enrollCanaryTask(root, {
		task_id: TASK,
		intent_path: binding.intent_path,
		intent_revision: 1,
		preparation_digest: prep.digest,
		readiness_digest: binding.readiness_digest,
		evidence_digest: binding.evidence_digest,
		capability: registry.issue(binding),
		capability_binding: binding,
		now: "2026-08-14T00:00:00.000Z",
	}, registry);
	return root;
}

function uiContext(root: string) {
	const status: string[] = [];
	const widgets: unknown[] = [];
	return {
		status,
		widgets,
		ctx: {
			mode: "tui",
			cwd: root,
			signal: new AbortController().signal,
			ui: {
				notify() {},
				confirm: async () => true,
				setStatus: (_key: string, value: string | undefined) => value && status.push(value),
				setWidget: (_key: string, value: unknown) => widgets.push(value),
			},
		},
	};
}

interface RegisteredTool {
	parameters: { properties?: Record<string, unknown> };
	execute: (id: string, params: unknown, signal: AbortSignal, onUpdate: unknown, ctx: unknown) => Promise<{ content?: Array<{ text: string }>; details?: Record<string, unknown> }>;
}

function surface(dependencies: Record<string, unknown>) {
	const tools: RegisteredTool[] = [];
	const messages: Array<{ message: any; options: any }> = [];
	const mod = require("../plugins/immune-brain/.pi-extension/imm-canary-work.ts");
	const pi = {
		registerTool: (tool: RegisteredTool) => tools.push(tool),
		registerMessageRenderer() {},
		registerCommand() {},
		on() {},
		sendMessage: (message: unknown, options: unknown) => messages.push({ message, options }),
	} as unknown as ExtensionAPI;
	mod.default(pi, dependencies);
	return { tool: tools[0], mod, messages };
}

function actionKinds(schema: Record<string, unknown>): string[] {
	const variants = schema.anyOf as Array<{ properties: { op: { const: string } } }>;
	return variants.map((variant) => variant.properties.op.const);
}

const ADVANCE_STATES = new Set(["started", "blocked", "awaiting_user", "completed"]);

function expectAdvanceState(result: { details?: Record<string, unknown> }): void {
	expect(ADVANCE_STATES.has(String(result.details?.state))).toBe(true);
}

describe("agent-callable assurance advance", () => {
	test("schema exposes only ordinary advance/cancel operations", () => {
		const { tool } = surface({});
		const action = tool.parameters.properties?.action as Record<string, unknown>;
		const kinds = actionKinds(action);
		expect(kinds).toContain("advance_assurance");
		expect(kinds).toContain("cancel_assurance");
		expect(kinds).toContain("request_authorization");
		expect(kinds).not.toContain("record_review_approval");
		expect(kinds).not.toContain("record_user_approval");
	});

	test("mismatched backend claim blocks before submit_review with zero TaskRecord writes", async () => {
		const root = enrolledRoot();
		try {
			const { tool } = surface({});
			const claimPath = join(root, ".imm", "tasks", ".backend-claim.json");
			const claim = JSON.parse(readFileSync(claimPath, "utf8"));
			writeFileSync(claimPath, `${JSON.stringify({ ...claim, task_id: "different-task" }, null, 2)}\n`);
			const recordPath = join(root, ".imm", "tasks", `${TASK}.json`);
			const before = readFileSync(recordPath, "utf8");
			const { ctx } = uiContext(root);
			const result = await tool.execute(
				"advance-mismatched-claim",
				{ task_id: TASK, action: { op: "advance_assurance" } },
				new AbortController().signal,
				undefined,
				ctx,
			);
			expectAdvanceState(result);
			expect(result.details?.state).toBe("blocked");
			expect(result.details?.reason).toMatch(/backend claim belongs to different-task/i);
			expect(readFileSync(recordPath, "utf8")).toBe(before);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("cancel racing delayed projection maps advance to blocked", async () => {
		const root = enrolledRoot();
		let releaseProjection!: () => void;
		const projectionGate = new Promise<void>((resolve) => { releaseProjection = resolve; });
		try {
			const { tool } = surface({ advanceBeforeProjection: () => projectionGate });
			const { ctx } = uiContext(root);
			const signal = new AbortController().signal;
			const advancePromise = tool.execute(
				"advance-racing-cancel",
				{ task_id: TASK, action: { op: "advance_assurance" } },
				signal,
				undefined,
				ctx,
			);
			await new Promise((resolve) => setTimeout(resolve, 0));
			const cancel = await tool.execute(
				"cancel-racing-advance",
				{ task_id: TASK, action: { op: "cancel_assurance" } },
				signal,
				undefined,
				ctx,
			);
			expect(cancel.details?.state).toBe("cancelled");
			releaseProjection();
			const advance = await advancePromise;
			expectAdvanceState(advance);
			expect(advance.details?.state).toBe("blocked");
			expect(advance.details?.reason).toMatch(/cancelled before dispatch/i);
		} finally {
			releaseProjection?.();
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("advance-inherited correlation survives immediate QA cancellation", async () => {
		const root = enrolledRoot();
		let releaseQaProjection!: () => void;
		const qaProjectionGate = new Promise<void>((resolve) => { releaseQaProjection = resolve; });
		try {
			const { tool, messages } = surface({ qaBeforeProjection: () => qaProjectionGate });
			const { ctx } = uiContext(root);
			const signal = new AbortController().signal;
			await tool.execute(
				"evidence",
				{ task_id: TASK, action: { op: "record_evidence", acceptance_id: "A1", status: "passed", summary: "fresh" } },
				signal,
				undefined,
				ctx,
			);
			const started = await tool.execute(
				"advance",
				{ task_id: TASK, action: { op: "advance_assurance" } },
				signal,
				undefined,
				ctx,
			);
			expect(started.details?.state).toBe("started");
			const cancelled = await tool.execute(
				"cancel",
				{ task_id: TASK, action: { op: "cancel_assurance" } },
				signal,
				undefined,
				ctx,
			);
			expect(cancelled.details?.state).toBe("cancelled");
			expect(messages).toHaveLength(1);
			expect(messages[0].options).toMatchObject({ triggerTurn: true, deliverAs: "followUp" });
			expect(messages[0].message.details).toMatchObject({
				task_id: TASK,
				operation_id: started.details?.operation_id,
				role: "qa",
				terminal: "cancelled",
				record_revision: expect.stringMatching(/^sha256:/),
				intent_content_hash: canonicalIntentHash(INTENT),
				diff_hash: expect.stringMatching(/^sha256:/),
			});
		} finally {
			releaseQaProjection?.();
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("returns a started operation, reuses duplicates, and cancels without waiting for QA terminal", async () => {
		const root = enrolledRoot();
		let markStarted!: () => void;
		const qaStarted = new Promise<void>((resolve) => { markStarted = resolve; });
		try {
			const { tool, mod } = surface({
				buildAssurance: async (_root: string, taskId: string, role: string, projection: any) => ({
					snapshot: mod.buildSnapshot({
						root,
						task_id: taskId,
						role,
						record_revision: projection.projection.record_revision,
						workspace_revision: projection.projection.workspace_revision,
						intent_revision: projection.projection.intent_revision,
						intent_content_hash: projection.projection.intent_content_hash,
						diff_hash: projection.projection.diff_hash,
						phase: projection.projection.phase,
						fresh_acceptance_ids: ["A1"],
						missing_acceptance_ids: [],
						stale_evidence_ids: [],
						acceptance: [],
						dirty_files: [],
						review_bundle_digest: null,
					}),
					descriptors: new Map(),
				}),
				runQa: async (_snapshot: unknown, _descriptors: unknown, _runner: unknown, options: { signal: AbortSignal }) =>
					new Promise((_resolve, reject) => {
						markStarted();
						options.signal.addEventListener("abort", () => reject(new Error("cancelled")), { once: true });
					}),
			});
			const { ctx, status, widgets } = uiContext(root);
			const signal = new AbortController().signal;
			await tool.execute("evidence", { task_id: TASK, action: { op: "record_evidence", acceptance_id: "A1", status: "passed", summary: "fresh" } }, signal, undefined, ctx);
			const first = await tool.execute("advance-1", { task_id: TASK, action: { op: "advance_assurance" } }, signal, undefined, ctx);
			expectAdvanceState(first);
			expect(first.details?.state).toBe("started");
			expect(first.details?.operation).toBe("qa");
			await qaStarted;
			expect(status).toEqual([]);
			expect(widgets).toEqual([]);

			const duplicate = await tool.execute("advance-2", { task_id: TASK, action: { op: "advance_assurance" } }, signal, undefined, ctx);
			expectAdvanceState(duplicate);
			expect(duplicate.details?.state).toBe("started");
			expect(duplicate.details?.operation_id).toBe(first.details?.operation_id);

			const cancelled = await tool.execute("cancel", { task_id: TASK, action: { op: "cancel_assurance" } }, signal, undefined, ctx);
			expect(cancelled.details?.state).toBe("cancelled");
			expect(cancelled.details?.operation_id).toBe(first.details?.operation_id);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
