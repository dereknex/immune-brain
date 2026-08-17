import { describe, expect, test } from "bun:test";
import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";

import {
	AssurancePresenter,
	type AssuranceFollowUp,
} from "../plugins/immune-brain/.pi-extension/pi-canary-assurance";
import { isSupersededFollowUp } from "../plugins/immune-brain/.pi-extension/pi-canary-assurance-progression";

const theme = {
	fg: (_color: string, text: string) => text,
	bold: (text: string) => text,
} as unknown as Theme;

function harness() {
	const messages: Array<{ message: { content?: string; details?: unknown }; options: unknown }> = [];
	const ctx = { mode: "tui", ui: {} } as unknown as ExtensionContext;
	const presenter = new AssurancePresenter({
		sendMessage: (message: unknown, options: unknown) => {
			messages.push({ message: message as { content?: string; details?: unknown }, options });
		},
	} as never);
	return { presenter, ctx, messages };
}

function followUp(overrides: Partial<AssuranceFollowUp> = {}): AssuranceFollowUp {
	return {
		contract: "assurance_kernel/assurance_follow_up/v1",
		task_id: "2026-08-16-007",
		operation_id: "op-old-1111-2222-3333-444455556666",
		role: "review",
		terminal: "verdict_ready",
		summary: "native review pass awaits literal-user confirmation",
		record_revision: "sha256:" + "a".repeat(64),
		intent_content_hash: "sha256:" + "b".repeat(64),
		diff_hash: "sha256:" + "c".repeat(64),
		...overrides,
	};
}

describe("notification correlation", () => {
	test("display text carries task_id and operation_id so old and new operations are distinguishable", () => {
		const { presenter, ctx, messages } = harness();
		presenter.publish(ctx, {} as never);
		const sent = presenter.deliverFollowUp(followUp());
		expect(sent).toBe(true);
		const content = messages[0].message.content ?? "";
		expect(content).toContain("for 2026-08-16-007");
		expect(content).toContain("op op-old-1111-2222-3333-444455556666");
		expect(content).not.toContain("[superseded]");
	});

	test("late delivery for a settled operation is annotated [superseded]", () => {
		const { presenter, ctx, messages } = harness();
		presenter.publish(ctx, {} as never);
		// Newer operation already delivered and settled; the old operation's
		// follow-up arrives late and must be visibly annotated.
		const current = followUp({ operation_id: "op-new-9999" });
		expect(presenter.deliverFollowUp(current)).toBe(true);
		const late = followUp({ operation_id: "op-old-1111-2222-3333-444455556666", superseded: true });
		expect(presenter.deliverFollowUp(late)).toBe(true);
		expect(messages[1].message.content ?? "").toContain("[superseded]");
		expect((messages[1].message.details as AssuranceFollowUp).superseded).toBe(true);
	});

	test("duplicated delivery of the same (task, operation, role) is suppressed", () => {
		const { presenter, ctx } = harness();
		presenter.publish(ctx, {} as never);
		expect(presenter.deliverFollowUp(followUp())).toBe(true);
		expect(presenter.deliverFollowUp(followUp())).toBe(false);
	});

	test("superseded predicate distinguishes current from stale operations", () => {
		expect(isSupersededFollowUp("op-new", "op-new")).toBe(false);
		expect(isSupersededFollowUp("op-new", "op-old")).toBe(true);
		expect(isSupersededFollowUp(undefined, "op-old")).toBe(true);
	});
});
