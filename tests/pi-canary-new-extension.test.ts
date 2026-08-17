// Phase 2: /imm-canary-new is a visible TUI launcher only. The Parent invokes
// the shared foreground imm_canary_enrollment Tool for all long-running work.

import { describe, expect, test } from "bun:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { readFileSync } from "node:fs";
import { join } from "node:path";

function loadNewSurface() {
	const commands = new Map<string, (args: string, ctx: ExtensionContext) => Promise<void>>();
	const messages: Array<{ message: string; options?: unknown }> = [];
	let toolCount = 0;
	const mod = require("../plugins/immune-brain/.pi-extension/imm-canary-new.ts");
	const factory = mod.default as (pi: ExtensionAPI) => void;
	factory({
		registerCommand: (
			name: string,
			spec: { handler: (args: string, ctx: ExtensionContext) => Promise<void> },
		) => commands.set(name, spec.handler),
		registerTool: () => { toolCount += 1; },
		sendUserMessage: (message: string, options?: unknown) => messages.push({ message, options }),
	} as unknown as ExtensionAPI);
	return { commands, messages, toolCount };
}

function context(mode = "tui", idle = true, notifications: string[] = []): ExtensionContext {
	return {
		mode,
		isIdle: () => idle,
		ui: {
			notify: (message: string) => notifications.push(message),
			confirm: async () => {
				throw new Error("launcher must not confirm");
			},
		},
	} as unknown as ExtensionContext;
}

describe("pi canary new foreground launcher", () => {
	test("registers only the imm-canary-new command", () => {
		const surface = loadNewSurface();
		expect([...surface.commands.keys()]).toEqual(["imm-canary-new"]);
		expect(surface.toolCount).toBe(0);
	});

	test("sends one visible Parent request for foreground Tool execution", async () => {
		const surface = loadNewSurface();
		await surface.commands.get("imm-canary-new")!("canary-new-task", context());
		expect(surface.messages).toHaveLength(1);
		expect(surface.messages[0].message).toContain("imm_canary_enrollment");
		expect(surface.messages[0].message).toContain(
			'{"action":"new","task_id":"canary-new-task"}',
		);
		expect(surface.messages[0].options).toBeUndefined();
	});

	test("uses host steering delivery while a Parent turn is active", async () => {
		const surface = loadNewSurface();
		await surface.commands.get("imm-canary-new")!("canary-new-task", context("tui", false));
		expect(surface.messages[0].options).toEqual({ deliverAs: "steer" });
	});

	test("rejects non-TUI, malformed, extra, and cancel arguments", async () => {
		const surface = loadNewSurface();
		const notifications: string[] = [];
		for (const [args, mode] of [
			["canary-new-task", "rpc"],
			["bad/id", "tui"],
			["canary-new-task extra", "tui"],
			["cancel canary-new-task", "tui"],
		] as const) {
			await surface.commands.get("imm-canary-new")!(args, context(mode, true, notifications));
		}
		expect(surface.messages).toEqual([]);
		expect(notifications.join("\n")).toMatch(/TUI-only|invalid task id/i);
	});

	test("source contains no enrollment, waiver, confirmation, or background lifecycle", () => {
		const source = readFileSync(
			join(__dirname, "..", "plugins/immune-brain/.pi-extension/imm-canary-new.ts"),
			"utf8",
		);
		expect(source).toContain("launchEnrollmentRequest");
		for (const forbidden of [
			"createEnrollmentAuthorityRegistry",
			"runDescriptorRehearsal",
			"enrollCanaryTask",
			"ctx.ui.confirm",
			"setWidget",
			"setStatus",
			"session_shutdown",
			"REHEARSAL WAIVER",
		]) {
			expect(source).not.toContain(forbidden);
		}
	});
});
