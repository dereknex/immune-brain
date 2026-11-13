// One Immune-Brain per process (issue #426, C-1): a second copy of the plugin,
// loaded from another directory as its own module instance and possibly by
// another resource loader, registers nothing and says so once.

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { claimProcess, COPY_CLAIM_KEY, copySource, duplicateCopyMessage } from "../plugins/immune-brain/.pi-extension/single-copy";

const global = globalThis as unknown as Record<symbol, unknown>;
let saved: unknown;
beforeEach(() => { saved = global[COPY_CLAIM_KEY]; delete global[COPY_CLAIM_KEY]; });
afterEach(() => { if (saved === undefined) delete global[COPY_CLAIM_KEY]; else global[COPY_CLAIM_KEY] = saved; });

/** A Pi API stand-in; each resource loader hands its extensions its own `events`. */
function fakePi() {
	const calls: string[] = [];
	const starts: Array<(event: unknown, ctx?: unknown) => unknown> = [];
	const pi = new Proxy({ events: {} }, {
		get: (target, name: string) => name === "events" ? target.events : (...args: unknown[]) => {
			calls.push(name);
			if (name === "on" && args[0] === "session_start") starts.push(args[1] as (event: unknown, ctx?: unknown) => unknown);
		},
	});
	return { pi, calls, starts };
}

describe("single Immune-Brain copy per process", () => {
	it("lets the first source own the process, keeps it on reload, refuses another live source, and lets a vanished owner go", () => {
		const store: Record<symbol, unknown> = {};
		const live = () => true;
		expect(claimProcess("/dev/immune-brain", live, store)).toEqual({ active: true, source: "/dev/immune-brain" });
		expect(claimProcess("/dev/immune-brain", live, store)).toEqual({ active: true, source: "/dev/immune-brain" });
		const second = claimProcess("/home/u/.pi/packages/immune-brain", live, store);
		expect(second).toEqual({ active: false, source: "/home/u/.pi/packages/immune-brain", owner: "/dev/immune-brain" });
		if (!second.active) expect(duplicateCopyMessage(second)).toContain("already loaded from /dev/immune-brain");
		expect(claimProcess("/home/u/.pi/packages/immune-brain", () => false, store)).toMatchObject({ active: true });
	});

	it("shares the claim with another module instance of the helper, as two plugin copies are", async () => {
		const dir = mkdtempSync(join(tmpdir(), "imm-single-copy-"));
		try {
			copyFileSync(new URL("../plugins/immune-brain/.pi-extension/single-copy.ts", import.meta.url), join(dir, "single-copy.ts"));
			const other = await import(pathToFileURL(join(dir, "single-copy.ts")).href) as typeof import("../plugins/immune-brain/.pi-extension/single-copy");
			expect(other.claimProcess).not.toBe(claimProcess);
			expect(claimProcess("/", () => true)).toMatchObject({ active: true });
			expect(other.claimProcess(dir, () => true)).toEqual({ active: false, source: dir, owner: "/" });
		} finally { rmSync(dir, { recursive: true, force: true }); }
	});

	it("resolves a factory module to its plugin root", () => {
		expect(copySource(new URL("../plugins/immune-brain/.pi-extension/imm-canary-work.ts", import.meta.url).href)).toEndWith("plugins/immune-brain");
	});

	it("registers no tool from either factory, in any loader, when another live copy owns the process, and notices once", async () => {
		claimProcess("/", () => true);
		const work = (await import("../plugins/immune-brain/.pi-extension/imm-canary-work")).default;
		const batch = (await import("../plugins/immune-brain/.pi-extension/imm-unattended-batch")).default;
		const first = fakePi();
		work(first.pi as never);
		batch(first.pi as never);
		expect(first.calls).toEqual(["on"]);
		const notices: string[] = [];
		const ctx = { ui: { notify: (message: string) => notices.push(message) } };
		first.starts[0](undefined, ctx);
		first.starts[0](undefined, ctx);
		expect(notices).toHaveLength(1);
		expect(notices[0]).toContain("already loaded from /;");
		const otherLoader = fakePi();
		batch(otherLoader.pi as never);
		expect(otherLoader.calls).toEqual([]);
	});

	it("registers its tools as before in every loader once it owns the process", async () => {
		const batch = (await import("../plugins/immune-brain/.pi-extension/imm-unattended-batch")).default;
		for (const _loader of [1, 2]) {
			const { pi, calls } = fakePi();
			batch(pi as never);
			expect(calls).toContain("registerTool");
		}
	});
});
