import { describe, expect, test } from "bun:test";
import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";

import {
	boundedVerificationFailureDetail,
} from "../plugins/immune-brain/.pi-extension/imm-canary-work";
import {
	ASSURANCE_STATUS_KEY,
	ASSURANCE_WIDGET_KEY,
	AssurancePresenter,
	renderAssuranceResultMessage,
	renderCanaryCall,
	renderCanaryResult,
	type AssuranceView,
} from "../plugins/immune-brain/.pi-extension/pi-canary-assurance";

const theme = {
	fg: (_color: string, text: string) => text,
	bold: (text: string) => text,
} as unknown as Theme;

function harness(mode = "tui") {
	const status: Array<[string, string | undefined]> = [];
	const widgets: Array<[string, unknown]> = [];
	const messages: Array<{ message: unknown; options: unknown }> = [];
	const ctx = {
		mode,
		ui: {
			setStatus: (key: string, value: string | undefined) => status.push([key, value]),
			setWidget: (key: string, value: unknown) => widgets.push([key, value]),
		},
	} as unknown as ExtensionContext;
	const presenter = new AssurancePresenter({
		sendMessage: (message: unknown, options: unknown) => {
			messages.push({ message, options });
		},
	} as never);
	return { presenter, ctx, status, widgets, messages };
}

function view(overrides: Partial<AssuranceView> = {}): AssuranceView {
	return {
		task_id: "task-visible",
		operation_id: "op-visible",
		role: "review",
		lifecycle: "starting",
		stage: "spawning native subagent",
		started_at: Date.now(),
		deadline_seconds: 300,
		telemetry: "native_lifecycle_only",
		...overrides,
	};
}

describe("Pi canary assurance observability", () => {
	test("keeps the actionable tail of bounded verifier failure output", () => {
		const detail = boundedVerificationFailureDetail(
			"",
			`${"setup noise\n".repeat(1000)}FAIL expected request_authorization but received manual command`,
		);
		expect(detail.length).toBeLessThanOrEqual(500);
		expect(detail).toContain("setup noise");
		expect(detail).toContain("FAIL expected request_authorization");
	});

	test("does not publish custom Footer or Widget", () => {
		const h = harness();
		h.presenter.publish(h.ctx, view());
		expect(h.status).toEqual([]);
		expect(h.widgets).toEqual([]);
	});

	test("clears leftover Footer and Widget keys from older sessions", () => {
		const h = harness();
		h.presenter.publish(h.ctx, view());
		h.presenter.clear();
		expect(h.status.at(-1)).toEqual([ASSURANCE_STATUS_KEY, undefined]);
		expect(h.widgets.at(-1)).toEqual([ASSURANCE_WIDGET_KEY, undefined]);
	});

	test("renderCall shows task id and operation", () => {
		const rendered = renderCanaryCall(
			{ task_id: "task-visible", action: { op: "advance_assurance" } },
			theme,
		).render(120).join("\n");
		expect(rendered).toContain("imm_kernel_canary");
		expect(rendered).toContain("advance_assurance");
		expect(rendered).toContain("task-visible");
		expect(rendered).not.toContain("native activity telemetry");
	});

	test("renderResult shows a compact status/result/next-action hierarchy", () => {
		const rendered = renderCanaryResult(
			{
				details: {
					state: "status",
					operation: "status",
					phase: "working",
					result: "2/5 acceptance items fresh; 1 blocker",
					next_action: "record remaining acceptance evidence",
					record_revision: "sha256:record",
					diff_hash: "sha256:diff",
				},
			},
			theme,
		).render(120).join("\n");
		expect(rendered).toContain("Status: working");
		expect(rendered).toContain("Result: 2/5 acceptance items fresh; 1 blocker");
		expect(rendered).toContain("Next: record remaining acceptance evidence");
		expect(rendered).not.toContain("sha256:");
		expect(rendered).not.toContain("native activity telemetry");
	});

	test("renders findings as a compact summary with expanded advisory detail", () => {
		const message = {
			content: "fallback",
			details: {
				contract: "assurance_kernel/assurance_follow_up/v1" as const,
				task_id: "task-visible",
				operation_id: "op-visible",
				role: "review" as const,
				terminal: "verdict_ready" as const,
				summary: "literal-user confirmation required",
				next_action: "request_authorization" as const,
				record_revision: "sha256:record",
				intent_content_hash: "sha256:intent",
				diff_hash: "sha256:diff",
				presentation: {
					passed_acceptance_ids: ["A1", "A2"],
					missing_acceptance_ids: ["A3"],
					findings: [
						{ id: "review-1", kind: "blocking" as const, acceptance_id: "A3", summary: "must fix" },
						{ id: "review-2", kind: "advisory" as const, acceptance_id: null, summary: "consider cleanup" },
					],
				},
			},
		};
		const compact = renderAssuranceResultMessage(message, { expanded: false }, theme).render(120).join("\n");
		expect(compact).toContain("Status: Review verdict ready");
		expect(compact).toContain("Result: Blockers: 1 | Warnings: 1 | Passed: 2 | Missing: 1");
		expect(compact).toContain("Next: Agent opens native confirmation");
		expect(compact).toContain("review-1");
		expect(compact).not.toContain("review-2");
		expect(compact).not.toContain("Passed acceptance");
		expect(compact).not.toContain("sha256:");

		const expanded = renderAssuranceResultMessage(message, { expanded: true }, theme).render(120).join("\n");
		expect(expanded).toContain("review-2");
		expect(expanded).toContain("Passed acceptance: A1, A2");
		expect(expanded).toContain("Missing acceptance: A3");
	});

	test("degrades malformed replayed message details without throwing", () => {
		const rendered = renderAssuranceResultMessage({
			content: [{ type: "text", text: "multimodal" }],
			details: {
				task_id: "task-visible",
				role: "review",
				terminal: "verdict_ready",
				summary: "review awaits confirmation",
				presentation: { findings: "corrupt" },
			},
		}, { expanded: true, outputPad: 0 }, theme).render(120).join("\n");
		expect(rendered).toContain("Status: Review verdict ready");
		expect(rendered).toContain("Result: review awaits confirmation");
		expect(rendered).not.toContain("Blockers:");

		const fallback = renderAssuranceResultMessage(
			{ content: [{ type: "text", text: "multimodal" }], details: null },
			{ expanded: false, outputPad: 0 },
			theme,
		).render(120).join("\n");
		expect(fallback).toContain("Assurance result unavailable");
	});

	test("deduplicates correlated parent follow-up by operation and role", () => {
		const h = harness();
		const payload = {
			contract: "assurance_kernel/assurance_follow_up/v1" as const,
			task_id: "task-visible",
			operation_id: "op-visible",
			role: "review" as const,
			terminal: "verdict_ready",
			summary: "review is ready",
			next_action: "request_authorization" as const,
			record_revision: "sha256:record",
			intent_content_hash: "sha256:intent",
			diff_hash: "sha256:diff",
		};
		expect(h.presenter.deliverFollowUp(payload)).toBe(true);
		expect(h.presenter.deliverFollowUp(payload)).toBe(false);
		expect(h.presenter.deliverFollowUp({
			...payload,
			terminal: "timed_out",
			summary: "conflicting late terminal",
		})).toBe(false);
		expect(h.messages).toHaveLength(1);
		expect(h.messages[0].options).toEqual({ triggerTurn: true, deliverAs: "followUp" });
		expect((h.messages[0].message as { details: unknown }).details).toEqual(payload);
		expect((h.messages[0].message as { content: string }).content).toContain(
			"Call imm_kernel_canary request_authorization now; native confirmation is the only user interaction",
		);
	});

	test("allows follow-up retry when the host send fails", () => {
		let calls = 0;
		const presenter = new AssurancePresenter({
			sendMessage: () => {
				calls += 1;
				if (calls === 1) throw new Error("session queue unavailable");
			},
		} as never);
		const payload = {
			contract: "assurance_kernel/assurance_follow_up/v1" as const,
			task_id: "task-visible",
			operation_id: "op-retry",
			role: "qa" as const,
			terminal: "failed" as const,
			summary: "retry",
			next_action: "inspect_assurance_failure" as const,
			record_revision: "sha256:record",
			intent_content_hash: "sha256:intent",
			diff_hash: "sha256:diff",
		};
		expect(presenter.deliverFollowUp(payload)).toBe(false);
		expect(presenter.deliverFollowUp(payload)).toBe(true);
		expect(calls).toBe(2);
	});
});
