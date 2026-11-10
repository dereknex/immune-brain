// One Immune-Brain per Pi resource loader (issue #426, C-1): a second copy of
// the plugin loaded from another directory by the same loader registers
// nothing and says so once.

import { describe, expect, it } from "bun:test";
import { claimLoader, copySource, duplicateCopyMessage, loaderScope } from "../plugins/immune-brain/.pi-extension/single-copy";

/** A Pi API stand-in; extensions loaded by one resource loader share `events`. */
function fakePi(events: object) {
	const calls: string[] = [];
	const starts: Array<(event: unknown, ctx?: unknown) => unknown> = [];
	const pi = new Proxy({ events }, {
		get: (target, name: string) => name === "events" ? target.events : (...args: unknown[]) => {
			calls.push(name);
			if (name === "on" && args[0] === "session_start") starts.push(args[1] as (event: unknown, ctx?: unknown) => unknown);
		},
	});
	return { pi, calls, starts };
}

describe("single Immune-Brain copy per Pi resource loader", () => {
	it("lets the first source own a loader, keeps it on reload, refuses another live source, and lets a vanished owner go", () => {
		const loader = {};
		const live = () => true;
		expect(claimLoader(loader, "/dev/immune-brain", live)).toEqual({ active: true, source: "/dev/immune-brain" });
		expect(claimLoader(loader, "/dev/immune-brain", live)).toEqual({ active: true, source: "/dev/immune-brain" });
		const second = claimLoader(loader, "/home/u/.pi/packages/immune-brain", live);
		expect(second).toEqual({ active: false, source: "/home/u/.pi/packages/immune-brain", owner: "/dev/immune-brain" });
		if (!second.active) expect(duplicateCopyMessage(second)).toContain("already loaded from /dev/immune-brain");
		expect(claimLoader(loader, "/home/u/.pi/packages/immune-brain", () => false)).toMatchObject({ active: true });
		expect(claimLoader({}, "/elsewhere", live)).toMatchObject({ active: true });
	});

	it("claims Pi's loader-wide event bus, or the API object when there is none", () => {
		const events = {};
		expect(loaderScope({ events })).toBe(events);
		const bare = {};
		expect(loaderScope(bare)).toBe(bare);
	});

	it("resolves a factory module to its plugin root", () => {
		expect(copySource(new URL("../plugins/immune-brain/.pi-extension/imm-canary-work.ts", import.meta.url).href)).toEndWith("plugins/immune-brain");
	});

	it("registers no tool from either factory when another live copy owns the loader, and notices once", async () => {
		const events = {};
		claimLoader(events, "/", () => true);
		const work = (await import("../plugins/immune-brain/.pi-extension/imm-canary-work")).default;
		const batch = (await import("../plugins/immune-brain/.pi-extension/imm-unattended-batch")).default;
		const { pi, calls, starts } = fakePi(events);
		work(pi as never);
		batch(pi as never);
		expect(calls).toEqual(["on"]);
		const notices: string[] = [];
		const ctx = { ui: { notify: (message: string) => notices.push(message) } };
		starts[0](undefined, ctx);
		starts[0](undefined, ctx);
		expect(notices).toHaveLength(1);
		expect(notices[0]).toContain("already loaded from /;");
	});

	it("registers its tools as before in a loader it owns, and another loader is unaffected", async () => {
		const batch = (await import("../plugins/immune-brain/.pi-extension/imm-unattended-batch")).default;
		for (const events of [{}, {}]) {
			const { pi, calls } = fakePi(events);
			batch(pi as never);
			expect(calls).toContain("registerTool");
		}
	});
});
