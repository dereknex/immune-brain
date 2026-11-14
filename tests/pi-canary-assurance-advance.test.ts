import { expect, test } from "bun:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

function surface() {
	const tools: any[] = [];
	const events: string[] = [];
	const mod = require("../plugins/immune-brain/.pi-extension/imm-canary-work.ts");
	const pi = {
		registerTool: (tool: unknown) => tools.push(tool),
		registerCommand() {},
		registerMessageRenderer() {},
		on: (name: string) => events.push(name),
		sendMessage() {},
	} as unknown as ExtensionAPI;
	mod.default(pi);
	return { tool: tools[0], events, source: require("node:fs").readFileSync("plugins/immune-brain/.pi-extension/imm-canary-work.ts", "utf8") as string };
}
function operations(value: unknown, out: string[] = []): string[] {
	if (!value || typeof value !== "object") return out;
	const object = value as Record<string, unknown>;
	if (object.const && typeof object.const === "string") out.push(object.const);
	for (const child of Object.values(object)) operations(child, out);
	return out;
}

test("assurance Tool exposes direct advance and verdict submission, without cancel action", () => {
	const { tool } = surface();
	const actions = operations(tool.parameters);
	expect(actions).toContain("advance_assurance");
	expect(actions).toContain("submit_review");
	expect(actions).toContain("request_authorization");
	expect(actions).not.toContain("cancel_assurance");
});

test("assurance does not depend on a terminal Agent lifecycle event", () => {
	const { events } = surface();
	expect(events).toContain("session_shutdown");
	expect(events).not.toContain("tool_execution_end");
});

test("assurance source contains no detached UI or result-polling path", async () => {
	const { source } = surface();
	const runtimeSource = require("node:fs").readFileSync("plugins/immune-brain/.pi-extension/pi-host-runtime.ts", "utf8") as string;
	for (const forbidden of ["startQa", "startReview", "get_subagent_result", "setWidget(", "setStatus(", "setTimeout(", "setInterval(", "deliverFollowUp"]) {
		expect(source).not.toContain(forbidden);
		expect(runtimeSource).not.toContain(forbidden);
	}
	expect(source).toContain("await runtime.advance(");
	expect(source).toContain("await runtime.submitReview(");
	expect(runtimeSource).toContain("this.runtime.advance(");
	expect(runtimeSource).toContain("this.runtime.submitReview(");

	const { PiRuntime } = await import("../plugins/immune-brain/.pi-extension/pi-host-runtime");
	const runtime = new PiRuntime({
		cwd: process.cwd(),
		ports: {
			projectTask: async () => ({ error: "no active claim" } as never),
		},
	});
	expect(await runtime.advance("missing-task")).toMatchObject({ state: "blocked" });
	expect(await runtime.submitReview("missing-task", undefined)).toMatchObject({ state: "blocked" });
});

test("Pi review host contains no duplicate pending-verifier state machine", () => {
	const progressionSource = require("node:fs").readFileSync("plugins/immune-brain/.pi-extension/pi-canary-assurance-progression.ts", "utf8") as string;
	expect(progressionSource).not.toContain("this.verifiers = new Map");
	expect(progressionSource).not.toContain("RecordedVerificationReceipt");
	expect(progressionSource).toContain("VerifierObservation");
	expect(progressionSource).toContain("PI_VERIFIER_PROFILE");
});
