import { expect, test } from "bun:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import enrollExtension, {
	ForegroundEnrollmentCoordinator,
	type EnrollmentAction,
	type EnrollmentTerminal,
} from "../plugins/immune-brain/.pi-extension/imm-canary-enroll.ts";
import newTaskExtension from "../plugins/immune-brain/.pi-extension/imm-canary-new.ts";

interface RegisteredTool {
	name: string;
	execute: (...args: any[]) => Promise<any>;
	renderCall?: (...args: any[]) => unknown;
	renderResult?: (...args: any[]) => unknown;
}

function loadEnrollmentSurface() {
	const commands = new Map<string, (args: string, ctx: ExtensionContext) => Promise<void>>();
	const tools: RegisteredTool[] = [];
	const shutdown: Array<() => Promise<void>> = [];
	const messages: string[] = [];
	const pi = {
		registerCommand: (
			name: string,
			spec: { handler: (args: string, ctx: ExtensionContext) => Promise<void> },
		) => commands.set(name, spec.handler),
		registerTool: (tool: RegisteredTool) => tools.push(tool),
		sendUserMessage: (message: string) => messages.push(message),
		on: (event: string, handler: () => Promise<void>) => {
			if (event === "session_shutdown") shutdown.push(handler);
		},
	} as unknown as ExtensionAPI;
	enrollExtension(pi);
	newTaskExtension(pi);
	return { commands, tools, shutdown, messages };
}

function tuiContext(notifications: string[] = []): ExtensionContext {
	return {
		mode: "tui",
		cwd: process.cwd(),
		isIdle: () => true,
		ui: {
			notify: (message: string) => notifications.push(message),
			confirm: async () => {
				throw new Error("launcher must not confirm");
			},
			setWidget: () => {
				throw new Error("launcher must not render a Widget");
			},
			setStatus: () => {
				throw new Error("Footer must remain empty");
			},
		},
	} as unknown as ExtensionContext;
}

test("Enrollment registers one foreground Tool and two thin visible launchers", async () => {
	const surface = loadEnrollmentSurface();
	expect(surface.tools.map((tool) => tool.name)).toEqual(["imm_canary_enrollment"]);
	expect([...surface.commands.keys()].sort()).toEqual(["imm-canary-enroll", "imm-canary-new"]);
	expect(surface.shutdown).toHaveLength(1);

	for (const [command, action] of [
		["imm-canary-new", "new"],
		["imm-canary-enroll", "enroll"],
	] as const) {
		await surface.commands.get(command)!("task-visible", tuiContext());
		expect(surface.messages.at(-1)).toContain("imm_canary_enrollment");
		expect(surface.messages.at(-1)).toContain(`\"action\":\"${action}\"`);
		expect(surface.messages.at(-1)).toContain(`\"task_id\":\"task-visible\"`);
	}

	const tool = surface.tools[0];
	expect(typeof tool.execute).toBe("function");
	expect(typeof tool.renderCall).toBe("function");
	expect(typeof tool.renderResult).toBe("function");
});

test("launchers reject cancel syntax and non-TUI calls without sending a Parent request", async () => {
	const surface = loadEnrollmentSurface();
	const notifications: string[] = [];
	await surface.commands.get("imm-canary-new")!("cancel task-visible", tuiContext(notifications));
	await surface.commands.get("imm-canary-enroll")!(
		"task-visible",
		{ ...tuiContext(notifications), mode: "rpc" } as ExtensionContext,
	);
	expect(surface.messages).toEqual([]);
	expect(notifications.join("\n")).toMatch(/invalid task id|TUI-only/i);
});

function coordinatorResult(action: EnrollmentAction, taskId: string, state: EnrollmentTerminal["state"]): EnrollmentTerminal {
	return {
		contract: "assurance_kernel/enrollment_tool_result/v1",
		state,
		action,
		task_id: taskId,
		stage: "test",
		summary: state,
		next_action: "none",
	};
}

test("foreground coordinator is single-flight and shutdown closes pre-commit work", async () => {
	const coordinator = new ForegroundEnrollmentCoordinator();
	let releaseFirst!: () => void;
	const first = coordinator.run("new", "task-first", undefined, async () => {
		await new Promise<void>((resolve) => { releaseFirst = resolve; });
		return coordinatorResult("new", "task-first", "rejected");
	});
	await Bun.sleep(0);
	let blockedWorkCalls = 0;
	const sameTaskSecond = await coordinator.run("enroll", "task-first", undefined, async () => {
		blockedWorkCalls += 1;
		return coordinatorResult("enroll", "task-first", "completed");
	});
	expect(sameTaskSecond.state).toBe("blocked");
	expect(sameTaskSecond.summary).toContain("task-first");
	const third = await coordinator.run("enroll", "task-third", undefined, async () => {
		blockedWorkCalls += 1;
		return coordinatorResult("enroll", "task-third", "completed");
	});
	expect(third.state).toBe("blocked");
	expect(third.summary).toContain("task-first");
	expect(blockedWorkCalls).toBe(0);
	releaseFirst();
	expect((await first).state).toBe("rejected");
	expect((await coordinator.run("enroll", "task-after-settlement", undefined, async () =>
		coordinatorResult("enroll", "task-after-settlement", "completed"))).state).toBe("completed");

	const shutdownCoordinator = new ForegroundEnrollmentCoordinator();
	let observedAbort = false;
	const active = shutdownCoordinator.run("new", "task-shutdown", undefined, (signal) =>
		new Promise<EnrollmentTerminal>((resolve) => {
			signal.addEventListener("abort", () => {
				observedAbort = true;
				resolve(coordinatorResult("new", "task-shutdown", "cancelled"));
			}, { once: true });
		}));
	await Bun.sleep(0);
	await shutdownCoordinator.shutdown();
	expect(observedAbort).toBe(true);
	expect((await active).state).toBe("cancelled");
	expect((await shutdownCoordinator.run("new", "task-after", undefined, async () =>
		coordinatorResult("new", "task-after", "completed"))).state).toBe("blocked");
});

test("commit linearization ignores later host cancellation and settles", async () => {
	const coordinator = new ForegroundEnrollmentCoordinator();
	const host = new AbortController();
	let releaseCommit!: () => void;
	let commitSignal: AbortSignal | undefined;
	const active = coordinator.run("enroll", "task-commit", host.signal, async (signal, beginCommit) => {
		commitSignal = signal;
		expect(beginCommit()).toBe(true);
		await new Promise<void>((resolve) => { releaseCommit = resolve; });
		return coordinatorResult("enroll", "task-commit", "completed");
	});
	await Bun.sleep(0);
	host.abort(new Error("too late"));
	expect(commitSignal?.aborted).toBe(false);
	const shutdown = coordinator.shutdown();
	let shutdownSettled = false;
	void shutdown.then(() => { shutdownSettled = true; });
	await Bun.sleep(0);
	expect(shutdownSettled).toBe(false);
	releaseCommit();
	expect((await active).state).toBe("completed");
	await shutdown;
});

test("Enrollment source has no detached job, Widget, Footer, completion push, or recovery polling", () => {
	const root = join(__dirname, "..", "plugins", "immune-brain", ".pi-extension");
	const enroll = readFileSync(join(root, "imm-canary-enroll.ts"), "utf8");
	const create = readFileSync(join(root, "imm-canary-new.ts"), "utf8");
	const combined = `${enroll}\n${create}`;
	for (const forbidden of [
		"EnrollmentJobCoordinator",
		"BACKGROUND_ENROLLMENT_CONTEXT",
		"setWidget(",
		"setStatus(",
		"get_subagent_result",
		"descriptor rehearsal started in the background",
		"input remains available",
		"cancel <task-id>",
	]) {
		expect(combined).not.toContain(forbidden);
	}
	expect(enroll.match(/registerTool\(/g)).toHaveLength(1);
	expect(enroll).toContain('name: "imm_canary_enrollment"');
	expect(enroll).toContain("onUpdate");
	expect(enroll).toContain("renderCall");
	expect(enroll).toContain("renderResult");
});
