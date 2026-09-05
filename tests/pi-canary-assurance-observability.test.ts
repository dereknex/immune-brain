import { describe, expect, test } from "bun:test";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { AssurancePresenter, renderCanaryCall, renderCanaryResult } from "../plugins/immune-brain/.pi-extension/pi-canary-assurance";

const theme = { fg: (_color: string, text: string) => text, bold: (text: string) => text } as unknown as Theme;

test("assurance presenter is passive and does not mutate Footer, Widget, or transcript follow-ups", () => {
	const presenter = new AssurancePresenter();
	expect(() => presenter.publish({} as never, {} as never)).not.toThrow();
	expect(() => presenter.reset()).not.toThrow();
	expect(Object.getOwnPropertyNames(Object.getPrototypeOf(presenter))).not.toContain("deliverFollowUp");
});

test("native Tool rendering keeps task and operation visible", () => {
	const rendered = renderCanaryCall({ task_id: "task-visible", action: { op: "advance_assurance" } }, theme).render(120).join("\n");
	expect(rendered).toContain("imm_kernel_canary");
	expect(rendered).toContain("advance_assurance");
	expect(rendered).toContain("task-visible");
});

test("result rendering shows direct state and next action without authority digests", () => {
	const rendered = renderCanaryResult({ details: { state: "review_ready", operation: "advance_assurance", result: "foreground Review ready", next_action: "invoke the exact Agent parameters" } }, theme).render(120).join("\n");
	expect(rendered).toContain("Result: foreground Review ready");
	expect(rendered).toContain("Next: invoke the exact Agent parameters");
	expect(rendered).not.toContain("sha256:");
});
