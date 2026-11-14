// The Parent final-verification decision is one function for the real entry and
// the Hook preview, so the confirmation a Hook shows cannot drift from the gate
// the MCP call opens.

import { describe, expect, test } from "bun:test";

import { nativeParentFinalDecision } from "../plugins/immune-brain/runtime/unattended/batch_git";

type Facts = Parameters<typeof nativeParentFinalDecision>[0];

function facts(over: { action?: string; missing?: string[]; recorded?: string[] } = {}): Facts {
	return {
		state: "native_parent",
		initiative_slug: "init",
		plan_digest: "sha256:plan",
		action: over.action ?? "verify",
		proof: { missing_task_ids: over.missing ?? [] },
		parent: { tasks: [{ task_id: "t1", slice_id: "s1" }, { task_id: "t2", slice_id: "s2" }] },
		native: over.recorded ? { final_verification: { results: over.recorded.map((command) => ({ command })) } } : undefined,
	} as unknown as Facts;
}

describe("nativeParentFinalDecision", () => {
	test("new commands on a delivered Parent need a gate bound to the plan and children", () => {
		expect(nativeParentFinalDecision(facts(), ["bun test"])).toEqual({
			run: true,
			commands: ["bun test"],
			recorded: false,
			gate: {
				initiative_slug: "init",
				plan_digest: "sha256:plan",
				children: [{ task_id: "t1", slice_id: "s1" }, { task_id: "t2", slice_id: "s2" }],
				final_commands: ["bun test"],
			},
		});
		expect(nativeParentFinalDecision(facts({ action: "repair" }), ["bun test"])).toMatchObject({ run: true, gate: expect.anything() });
	});

	test("recorded commands replay without a gate", () => {
		expect(nativeParentFinalDecision(facts({ recorded: ["bun test"] }), undefined)).toMatchObject({
			run: true,
			commands: ["bun test"],
			recorded: true,
			gate: null,
		});
		expect(nativeParentFinalDecision(facts({ recorded: ["bun test"] }), ["bun test"])).toMatchObject({ run: true, gate: null });
	});

	test("commands that differ from the recorded ones demand a fresh Parent entry", () => {
		expect(() => nativeParentFinalDecision(facts({ recorded: ["bun test"] }), ["bun run typecheck"])).toThrow(
			"Parent final commands changed",
		);
	});

	test("nothing runs before delivery, with missing tasks, or without commands", () => {
		expect(nativeParentFinalDecision(facts({ action: "enroll" }), ["bun test"])).toEqual({ run: false });
		expect(nativeParentFinalDecision(facts({ action: "complete" }), ["bun test"])).toEqual({ run: false });
		expect(nativeParentFinalDecision(facts({ missing: ["t2"] }), ["bun test"])).toEqual({ run: false });
		expect(nativeParentFinalDecision(facts(), undefined)).toEqual({ run: false });
		expect(nativeParentFinalDecision(facts(), [])).toEqual({ run: false });
	});
});
