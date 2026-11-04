import { afterAll, describe, expect, it } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chooseExecutor, LaneSupervisor, superviseLane, type LaneGeneration, type LaneGenerationStore } from "../plugins/immune-brain/runtime/unattended/lane_supervisor";

const dirs: string[] = [];
const oldPath = process.env.PATH;
afterAll(() => { process.env.PATH = oldPath; for (const dir of dirs) rmSync(dir, { recursive: true, force: true }); });
function fixture() {
	const dir = realpathSync(mkdtempSync(join(tmpdir(), "lane-supervisor-"))); dirs.push(dir);
	const source = '#!/bin/sh\nprintf "%s\\n" "$PWD" "$@" > args.txt\nexec sleep 10\n';
	for (const name of ["claude", "pi"]) { const path = join(dir, name); writeFileSync(path, source); chmodSync(path, 0o755); }
	process.env.PATH = `${dir}:${oldPath}`;
	let value: LaneGeneration | null = null;
	const store: LaneGenerationStore = { read: () => value, update: fn => (value = fn(value)) };
	return { dir, store };
}

describe("Lane Executor supervision", () => {
	it("keeps model and effort with the layer selecting the Host", () => {
		expect(chooseExecutor([{ executor_model: "wrong" }, { executor_host: "pi", executor_effort: "high" },
			{ executor_host: "claude-code", executor_model: "other" }], "claude-code"))
			.toEqual({ host: "pi", effort: "high", not_applied: ["executor_model"] });
	});
	it("refuses a missing Executor without reserving a generation", async () => {
		const { dir, store } = fixture();
		const path = process.env.PATH; process.env.PATH = dir;
		rmSync(join(dir, "pi"));
		try {
			const result = await new LaneSupervisor().run({ key: dir, repository: dir, lanePath: dir, taskId: "task", choice: { host: "pi", not_applied: [] },
				pluginDir: "/plugin", store, baseline: "r1", waitMs: 50, graceMs: 50 });
			expect(result).toMatchObject({ state: "unavailable", generation: null }); expect(store.read()).toBeNull();
		} finally { process.env.PATH = path; }
	});
	it("a stop with no live generation changes nothing", async () => {
		const { dir, store } = fixture();
		const before = store.read();
		const result = await new LaneSupervisor().run({ key: dir, repository: dir, lanePath: dir, taskId: "task", choice: { host: "pi", not_applied: [] },
			pluginDir: "/plugin", store, baseline: "r1", waitMs: 50, graceMs: 50, stop: true });
		expect(result).toMatchObject({ state: "stopped", generation: null, exit: null }); expect(store.read()).toBe(before);
	});
	it("parks after two real exits without Kernel progress", async () => {
		const { dir, store } = fixture();
		writeFileSync(join(dir, "pi"), "#!/bin/sh\nexit 0\n");
		const result = await superviseLane(new LaneSupervisor(), { key: dir, repository: dir, lanePath: dir, taskId: "task",
			choice: { host: "pi", not_applied: [] }, pluginDir: "/plugin", store, baseline: "r1", waitMs: 500, graceMs: 100,
			project: async () => ({ record_revision: "r1", lifecycle: "active", next_obligation: "submit_assurance", open_user_decision_count: 0 }) });
		expect(result).toMatchObject({ state: "exited", generation: 2, reason: "lane_executor_no_progress" });
		expect(store.read()).toMatchObject({ no_progress: 2, handled_generation: 2 });
	});
	it("takes settlement from Kernel even when the Executor exits nonzero", async () => {
		const { dir, store } = fixture();
		writeFileSync(join(dir, "pi"), "#!/bin/sh\nexit 7\n");
		let reads = 0;
		const result = await superviseLane(new LaneSupervisor(), { key: dir, repository: dir, lanePath: dir, taskId: "task",
			choice: { host: "pi", not_applied: [] }, pluginDir: "/plugin", store, baseline: "r1", waitMs: 1000, graceMs: 100,
			project: async () => (++reads === 1
				? { record_revision: "r1", lifecycle: "active", next_obligation: "submit_assurance", open_user_decision_count: 0 }
				: { record_revision: "r2", lifecycle: "done", next_obligation: "none", open_user_decision_count: 0 }) });
		expect(result).toMatchObject({ state: "exited", generation: 1, exit: { code: 7, signal: null } });
		expect(store.read()).toMatchObject({ no_progress: 0, handled_generation: 1 });
	});
	for (const host of ["claude-code", "pi"] as const) {
		it(`${host} attaches simultaneous calls to one generation`, async () => {
			const { dir, store } = fixture();
			const supervisor = new LaneSupervisor();
			const input = { key: dir, repository: dir, lanePath: dir, taskId: "task", choice: { host, not_applied: [] },
				pluginDir: "/plugin", store, baseline: "r1", waitMs: 80, graceMs: 100 };
			try {
				const results = await Promise.all([supervisor.run(input), supervisor.run(input)]);
				expect(results).toEqual([expect.objectContaining({ state: "running", generation: 1 }), expect.objectContaining({ state: "running", generation: 1 })]);
			} finally { await supervisor.run({ ...input, stop: true }); }
		});
		it(`${host} escalates a stop to SIGKILL`, async () => {
			const { dir, store } = fixture();
			writeFileSync(join(dir, host === "pi" ? "pi" : "claude"), "#!/bin/sh\ntrap '' TERM\nprintf ready > ready\nexec /bin/sleep 30\n");
			const supervisor = new LaneSupervisor();
			const input = { key: dir, repository: dir, lanePath: dir, taskId: "task", choice: { host, not_applied: [] },
				pluginDir: "/plugin", store, baseline: "r1", waitMs: 80, graceMs: 100 };
			try {
				await supervisor.run(input);
				for (let attempt = 0; attempt < 100 && !existsSync(join(dir, "ready")); attempt++) await new Promise(resolve => setTimeout(resolve, 10));
				expect(existsSync(join(dir, "ready"))).toBe(true);
				expect(await supervisor.run({ ...input, stop: true })).toMatchObject({ state: "stopped", exit: { signal: "SIGKILL" } });
			} finally { await supervisor.run({ ...input, stop: true }); }
		});
		it(`${host} reports a lost handle as unobservable`, async () => {
			const { dir, store } = fixture();
			const original = new LaneSupervisor();
			const input = { key: dir, repository: dir, lanePath: dir, taskId: "task", choice: { host, not_applied: [] },
				pluginDir: "/plugin", store, baseline: "r1", waitMs: 80, graceMs: 100 };
			try {
				expect(await original.run(input)).toMatchObject({ state: "running", generation: 1 });
				const pid = store.read()!.pid;
				expect(await new LaneSupervisor().run(input)).toMatchObject({ state: "unobservable", generation: 1, exit: null });
				expect(store.read()).toMatchObject({ state: "unobservable", pid, exit: null });
			} finally { await original.run({ ...input, stop: true }); }
		});
		it(`${host} cancels the waiting process and records interruption`, async () => {
			const { dir, store } = fixture();
			const controller = new AbortController();
			const supervisor = new LaneSupervisor();
			const input = { key: dir, repository: dir, lanePath: dir, taskId: "task", choice: { host, not_applied: [] },
				pluginDir: "/plugin", store, baseline: "r1", waitMs: 1000, graceMs: 100, signal: controller.signal };
			const timer = setTimeout(() => controller.abort(), 100);
			try {
				expect(await supervisor.run(input)).toMatchObject({ state: "stopped", generation: 1 });
				expect(store.read()).toMatchObject({ state: "interrupted", exit: { generation: 1 } });
			} finally { clearTimeout(timer); }
		});
		it(`${host} waits, reattaches to the same process and stops it`, async () => {
			const { dir, store } = fixture();
			const supervisor = new LaneSupervisor();
			const input = { key: dir, repository: dir, lanePath: dir, taskId: "task", choice: { host, model: "model", effort: "high", not_applied: [] },
				pluginDir: "/plugin", store, baseline: "r1", waitMs: 80, graceMs: 100 };
			const herdr = process.env.HERDR_ENV; process.env.HERDR_ENV = "1";
			try {
			const first = await supervisor.run(input);
			expect(first).toMatchObject({ state: "running", generation: 1 });
			const pid = store.read()!.pid;
			expect(await supervisor.run(input)).toMatchObject({ state: "running", generation: 1 });
			expect(store.read()!.pid).toBe(pid);
			for (let attempt = 0; attempt < 200 && !existsSync(join(dir, "args.txt")); attempt++)
				await new Promise(resolve => setTimeout(resolve, 10));
			const argv = readFileSync(join(dir, "args.txt"), "utf8").trim().split("\n");
			expect(argv).toEqual([dir, "--print", ...(host === "claude-code" ? ["--plugin-dir", "/plugin"] : []), "--model", "model",
				host === "claude-code" ? "--effort" : "--thinking", "high", `${host === "claude-code" ? "/immune-brain:drive" : "/skill:drive"} task`]);
			const stopped = await supervisor.run({ ...input, stop: true });
			expect(stopped).toMatchObject({ state: "stopped", generation: 1 });
			expect(store.read()).toMatchObject({ state: "stopped_by_parent", exit: { pid, generation: 1 } });
			} finally {
				await supervisor.run({ ...input, stop: true });
				if (herdr === undefined) delete process.env.HERDR_ENV; else process.env.HERDR_ENV = herdr;
			}
		});
	}
});
