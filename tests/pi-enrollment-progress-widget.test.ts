import { expect, test } from "bun:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import enrollExtension, {
	ENROLLMENT_WIDGET_KEY,
	EnrollmentJobCoordinator,
} from "../plugins/immune-brain/.pi-extension/imm-canary-enroll.ts";
import newTaskExtension from "../plugins/immune-brain/.pi-extension/imm-canary-new.ts";

interface WidgetCall {
	key: string;
	content: string[] | undefined;
	options?: { placement?: string };
}

function makeContext() {
	const widgetCalls: WidgetCall[] = [];
	const statusCalls: Array<[string, string | undefined]> = [];
	const notifications: string[] = [];
	const ctx = {
		ui: {
			setWidget: (
				key: string,
				content: string[] | undefined,
				options?: { placement?: string },
			) => widgetCalls.push({ key, content, options }),
			setStatus: (key: string, text: string | undefined) => statusCalls.push([key, text]),
			notify: (message: string) => notifications.push(message),
		},
	} as unknown as ExtensionContext;
	return { ctx, widgetCalls, statusCalls, notifications };
}

function latestVisibleWidget(calls: WidgetCall[]): WidgetCall {
	const call = [...calls].reverse().find((candidate) => candidate.content !== undefined);
	if (!call) throw new Error("expected a visible enrollment Widget");
	return call;
}

test("Enrollment Widget renders bounded live progress and clears once at terminal settlement", async () => {
	let now = 0;
	let release!: () => void;
	const { ctx, widgetCalls, statusCalls } = makeContext();
	const coordinator = new EnrollmentJobCoordinator({
		now: () => now,
		refreshIntervalMs: 5,
	});
	const taskId = `task-${"x".repeat(123)}`;
	const work = async (): Promise<void> => {
		await new Promise<void>((resolve) => { release = resolve; });
	};

	expect(coordinator.start(taskId, "imm-canary-new", ctx, work)).toBe(true);
	const initial = latestVisibleWidget(widgetCalls);
	expect(initial.key).toBe(ENROLLMENT_WIDGET_KEY);
	expect(initial.options).toEqual({ placement: "aboveEditor" });
	expect(initial.content).toHaveLength(2);
	expect(initial.content?.[0]).toContain("preparing | elapsed 0s");
	expect(initial.content?.[0]).not.toContain(taskId);
	expect(initial.content?.[1]).toBe(`Action: /imm-canary-new cancel ${taskId}`);

	now = 65_000;
	await Bun.sleep(8);
	expect(latestVisibleWidget(widgetCalls).content?.[0]).toContain("elapsed 1m 5s");
	coordinator.updateStage(taskId, "awaiting confirmation");
	expect(latestVisibleWidget(widgetCalls).content?.[0]).toContain("awaiting confirmation");

	release();
	await Bun.sleep(0);
	expect(widgetCalls.filter((call) => call.content === undefined)).toHaveLength(1);
	expect(widgetCalls.at(-1)?.content).toBeUndefined();
	const terminalCallCount = widgetCalls.length;
	now = 120_000;
	await Bun.sleep(12);
	expect(widgetCalls).toHaveLength(terminalCallCount);
	expect(statusCalls).toEqual([]);
});

test("cancellation changes the action, aborts work, and leaves no stale refresh", async () => {
	const { ctx, widgetCalls, statusCalls } = makeContext();
	const coordinator = new EnrollmentJobCoordinator({ refreshIntervalMs: 5 });
	let signal: AbortSignal | undefined;
	const work = async (backgroundCtx: ExtensionContext): Promise<void> => {
		signal = backgroundCtx.signal;
		await new Promise<void>((resolve) => {
			backgroundCtx.signal.addEventListener("abort", () => resolve(), { once: true });
		});
	};

	expect(coordinator.start("task-cancel", "imm-canary-enroll", ctx, work)).toBe(true);
	coordinator.cancel("task-cancel", ctx);
	expect(signal?.aborted).toBe(true);
	expect(latestVisibleWidget(widgetCalls).content).toEqual([
		expect.stringContaining("cancelling"),
		"Cancellation requested; waiting for background work to close",
	]);
	await Bun.sleep(0);
	expect(widgetCalls.at(-1)?.content).toBeUndefined();

	expect(coordinator.start("task-next", "imm-canary-new", ctx, async () => {})).toBe(true);
	await Bun.sleep(0);
	expect(widgetCalls.at(-1)?.content).toBeUndefined();
	const settledCallCount = widgetCalls.length;
	await Bun.sleep(12);
	expect(widgetCalls).toHaveLength(settledCallCount);
	expect(statusCalls).toEqual([]);
});

test("commit disables cancellation and concurrent shutdown shares one settlement", async () => {
	const { ctx, widgetCalls, statusCalls, notifications } = makeContext();
	const coordinator = new EnrollmentJobCoordinator({ refreshIntervalMs: 5 });
	let signal: AbortSignal | undefined;
	let release!: () => void;
	const work = async (backgroundCtx: ExtensionContext): Promise<void> => {
		signal = backgroundCtx.signal;
		await new Promise<void>((resolve) => { release = resolve; });
	};

	expect(coordinator.start("task-commit", "imm-canary-new", ctx, work)).toBe(true);
	expect(coordinator.markCommitting("task-commit", ctx)).toBe(true);
	expect(latestVisibleWidget(widgetCalls).content).toEqual([
		expect.stringContaining("committing"),
		"Cancellation unavailable while Kernel enrollment settles",
	]);
	coordinator.cancel("task-commit", ctx);
	expect(signal?.aborted).toBe(false);
	expect(notifications.join("\n")).toContain("commit already owns settlement");

	const firstShutdown = coordinator.shutdown();
	const secondShutdown = coordinator.shutdown();
	expect(secondShutdown).toBe(firstShutdown);
	expect(latestVisibleWidget(widgetCalls).content?.[0]).toContain("shutdown waiting for commit");
	release();
	await firstShutdown;
	expect(widgetCalls.filter((call) => call.content === undefined)).toHaveLength(1);
	expect(widgetCalls.at(-1)?.content).toBeUndefined();
	const settledCallCount = widgetCalls.length;
	await coordinator.shutdown();
	expect(widgetCalls).toHaveLength(settledCallCount);
	expect(statusCalls).toEqual([]);
});

test("both Enrollment commands return after starting the shared background Widget owner", async () => {
	const root = mkdtempSync(join(tmpdir(), "enrollment-widget-command-"));
	try {
		const handlers = new Map<string, (args: string, ctx: ExtensionContext) => Promise<void>>();
		const shutdownHandlers: Array<() => Promise<void>> = [];
		const pi = {
			registerCommand: (
				name: string,
				spec: { handler: (args: string, ctx: ExtensionContext) => Promise<void> },
			) => handlers.set(name, spec.handler),
			on: (event: string, handler: () => Promise<void>) => {
				if (event === "session_shutdown") shutdownHandlers.push(handler);
			},
		} as unknown as ExtensionAPI;
		enrollExtension(pi);
		newTaskExtension(pi);
		const widgetCalls: WidgetCall[] = [];
		const statusCalls: Array<[string, string | undefined]> = [];
		const notifications: string[] = [];
		const ctx = {
			mode: "tui",
			cwd: root,
			signal: new AbortController().signal,
			ui: {
				setWidget: (
					key: string,
					content: string[] | undefined,
					options?: { placement?: string },
				) => widgetCalls.push({ key, content, options }),
				setStatus: (key: string, text: string | undefined) => statusCalls.push([key, text]),
				notify: (message: string) => notifications.push(message),
				confirm: async () => false,
			},
		} as unknown as ExtensionContext;

		for (const command of ["imm-canary-new", "imm-canary-enroll"]) {
			const handler = handlers.get(command);
			if (!handler) throw new Error(`missing ${command} handler`);
			const before = widgetCalls.length;
			await handler("task-command", ctx);
			expect(widgetCalls.slice(before).some((call) => call.content?.[0]?.includes("preparing"))).toBe(true);
			expect(notifications.some((message) => message.includes("input remains available"))).toBe(true);
			const deadline = Date.now() + 2_000;
			while (widgetCalls.at(-1)?.content !== undefined && Date.now() < deadline)
				await Bun.sleep(10);
			expect(widgetCalls.at(-1)?.content).toBeUndefined();
		}

		expect(shutdownHandlers).toHaveLength(2);
		await Promise.all(shutdownHandlers.map((handler) => handler()));
		expect(statusCalls).toEqual([]);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("Widget presentation failures cannot leak job ownership or block settlement", async () => {
	let widgetAttempts = 0;
	const notifications: string[] = [];
	const ctx = {
		ui: {
			setWidget: () => {
				widgetAttempts += 1;
				throw new Error("UI disposed");
			},
			notify: (message: string) => notifications.push(message),
		},
	} as unknown as ExtensionContext;
	const coordinator = new EnrollmentJobCoordinator({ refreshIntervalMs: 5 });

	expect(coordinator.start("task-first", "imm-canary-new", ctx, async () => {})).toBe(true);
	await Bun.sleep(0);
	expect(coordinator.start("task-second", "imm-canary-enroll", ctx, async () => {})).toBe(true);
	await Bun.sleep(0);
	await coordinator.shutdown();
	expect(widgetAttempts).toBeGreaterThanOrEqual(4);
	expect(notifications.some((message) => message.includes("preflight failed"))).toBe(false);
});
