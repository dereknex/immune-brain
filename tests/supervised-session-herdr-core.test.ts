// herdr-core adapter specifics beyond the shared conformance suite (ADR 0038):
// the exact `hc` commands, fail-closed admission, Host version gates and
// readiness, run against a stand-in `hc` built from herdr-core 0.1.19's docs.

import { afterEach, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { runSessionCli } from "../plugins/immune-brain/runtime/session/cli";
import { coreState, createHerdrCoreSessionProvider, herdrCoreName } from "../plugins/immune-brain/runtime/session/herdr_core_provider";
import { hcCalls, herdrCoreSubject } from "./helpers/fake-herdr-core";

const INPUT = { cwd: "/lanes/slice-a", label: "S1 slice-a", host: "claude-code" as const, hostArgs: ["--plugin-dir", "/p"], entry: "/immune-brain:drive slice-a" };

let cleanup: (() => void) | undefined;
afterEach(() => { cleanup?.(); cleanup = undefined; });
function subject(...args: Parameters<typeof herdrCoreSubject>) {
	const made = herdrCoreSubject(...args);
	cleanup = made.cleanup;
	return made;
}

describe("herdr-core adapter command spelling", () => {
	it("runs the Host in the background with no parent and an ownership label, then sends the entry only if idle", async () => {
		const { port, stateFile } = subject();
		const created = await port.createSession(INPUT);
		if (!created.ok) throw new Error(created.reason);
		const calls = hcCalls(stateFile);
		const run = calls[0];
		const token = run[run.indexOf("--label") + 1].replace("imm-session=", "");
		expect(token).toMatch(/^[0-9a-f]{24}$/);
		expect(run[run.indexOf("--name") + 1]).toMatch(/^s1-slice-a-[0-9a-f]{12}$/);
		expect(run).toEqual(["run", "--bg", "--json", "--no-parent", "--name", `s1-slice-a-${token.slice(0, 12)}`, "--cwd", "/lanes/slice-a", "--label", `imm-session=${token}`, "--", "claude", "--plugin-dir", "/p"]);
		expect(created.handle).toBe(`herdr-core:t1/${token}`);
		expect(calls.slice(1)).toEqual([["get", "t1", "--json"], ["send", "t1", INPUT.entry, "--if", "idle", "--json"]]);
	});

	it.each([["claude-code", "claude"], ["pi", "pi"], ["antigravity", "agy"]] as const)("runs a %s Executor as %s", async (host, binary) => {
		const { port, stateFile } = subject();
		expect(await port.createSession({ ...INPUT, host, hostArgs: [] })).toMatchObject({ ok: true, entry_submitted: true });
		expect(hcCalls(stateFile)[0].slice(-1)).toEqual([binary]);
	});

	it("never sends --force, which could answer a dialog", async () => {
		const { port, control, stateFile } = subject();
		const created = await port.createSession(INPUT);
		if (!created.ok) throw new Error(created.reason);
		control.setState(created.handle, "blocked");
		await port.sendInstruction(created.handle, "x");
		await port.createSession({ ...INPUT, resume: created.handle });
		expect(hcCalls(stateFile).flat()).not.toContain("--force");
	});

	it("stops with an interrupt then a kill, and closes by kill then rm", async () => {
		const { port, stateFile } = subject();
		const first = await port.createSession(INPUT);
		const second = await port.createSession({ ...INPUT, label: "b" });
		if (!first.ok || !second.ok) throw new Error("create refused");
		const before = hcCalls(stateFile).length;
		await port.stopSession(first.handle);
		await port.closeSession(second.handle, { task_id: "slice-a", recorded_at: "2020-01-01T00:00:00.000Z" });
		expect(hcCalls(stateFile).slice(before).filter(call => call[0] !== "get")).toEqual([
			["interrupt", "t1", "--json"],
			["kill", "t1", "--json"],
			["kill", "t2", "--json"],
			["rm", "t2", "--json"],
		]);
	});

	it("reads the screen alone for visible and 200 history lines for scrollback", async () => {
		const { port, stateFile } = subject();
		const created = await port.createSession(INPUT);
		if (!created.ok) throw new Error(created.reason);
		await port.readOutput(created.handle, "visible");
		await port.readOutput(created.handle, "scrollback");
		expect(hcCalls(stateFile).filter(call => call[0] === "read")).toEqual([["read", "t1", "--lines", "0", "--json"], ["read", "t1", "--lines", "200", "--json"]]);
	});

	it("maps reported words to port states, with error and silence as unknown, and derives unique core names", () => {
		expect(coreState("blocked")).toEqual({ state: "blocked", provenance: "reported" });
		expect(coreState("done")).toEqual({ state: "done", provenance: "reported" });
		expect(coreState("error")).toEqual({ state: "unknown", provenance: "none" });
		expect(coreState(null)).toEqual({ state: "unknown", provenance: "none" });
		const tok = "a1b2c3d4e5f6789012345678";
		expect(herdrCoreName("01 Slice/A", tok)).toBe("01-slice-a-a1b2c3d4e5f6");
		expect(herdrCoreName("---", tok)).toBe("lane-a1b2c3d4e5f6");
		expect(herdrCoreName("___", tok)).toBe("lane-a1b2c3d4e5f6");
		const longName = herdrCoreName("abcdefghijklmnopqrstuvwxyz012345", tok);
		expect(longName).toHaveLength(32);
		expect(longName).toMatch(/^[a-z0-9_-]{1,32}$/);
		expect(longName).toBe("abcdefghijklmnopqrs-a1b2c3d4e5f6");
		expect(herdrCoreName("abcdefghijklmnopqr-tuvwxyz", tok)).toBe("abcdefghijklmnopqr-a1b2c3d4e5f6");
		expect(herdrCoreName("01 Slice/A", "")).toBe("01-slice-a");
	});

	it("rejects duplicate live --name values in fake-herdr-core/hc until killed", () => {
		const { env } = subject();
		const runHc = (args: string[]) => spawnSync("hc", args, { env, encoding: "utf8" });
		const badName = runHc(["run", "--bg", "--json", "--no-parent", "--name", "BAD NAME", "--cwd", "/lanes/a", "--", "claude"]);
		expect(badName.status).toBe(1);
		expect(JSON.parse(badName.stderr)).toMatchObject({ error: { kind: "invalid_name" } });
		expect(runHc(["run", "--bg", "--json", "--no-parent", "--name", "dup-core", "--cwd", "/lanes/a", "--", "claude"]).status).toBe(0);
		const duplicate = runHc(["run", "--bg", "--json", "--no-parent", "--name", "dup-core", "--cwd", "/lanes/b", "--", "claude"]);
		expect(duplicate.status).toBe(1);
		expect(JSON.parse(duplicate.stderr)).toMatchObject({ error: { kind: "name_taken" } });
		expect(runHc(["kill", "t1", "--json"]).status).toBe(0);
		expect(runHc(["run", "--bg", "--json", "--no-parent", "--name", "dup-core", "--cwd", "/lanes/b", "--", "claude"]).status).toBe(0);
	});
});

describe("herdr-core instructions, resume and env", () => {
	it("sends to an idle session with --if idle and to a done session plainly, since --if cannot name done (O1)", async () => {
		const { port, control, stateFile } = subject();
		const created = await port.createSession(INPUT);
		if (!created.ok) throw new Error(created.reason);
		control.setState(created.handle, "done");
		expect(await port.sendInstruction(created.handle, "after done")).toMatchObject({ ok: true, state: "working" });
		control.setState(created.handle, "idle");
		expect(await port.sendInstruction(created.handle, "after idle")).toMatchObject({ ok: true });
		expect(hcCalls(stateFile).filter(call => call[0] === "send").slice(1)).toEqual([
			["send", "t1", "after done", "--json"],
			["send", "t1", "after idle", "--if", "idle", "--json"],
		]);
	});

	it("refuses to resume a finished terminal, sending nothing, so the caller creates a new session (C-2)", async () => {
		const { port, control, stateFile } = subject();
		const created = await port.createSession(INPUT);
		if (!created.ok) throw new Error(created.reason);
		control.exit(created.handle);
		const result = await port.createSession({ ...INPUT, resume: created.handle });
		expect(result).toMatchObject({ ok: false, code: "state_refused" });
		if (!result.ok) expect(result.reason).toContain("create a new session");
		expect(hcCalls(stateFile).filter(call => call[0] === "send")).toHaveLength(1);
	});

	it("sets --env for the Host alone through env", async () => {
		const { port, stateFile } = subject();
		expect(await port.createSession({ ...INPUT, env: { CLAUDE_CONFIG_DIR: "/tmp/empty" } })).toMatchObject({ ok: true });
		const run = hcCalls(stateFile)[0];
		expect(run.slice(run.indexOf("--"))).toEqual(["--", "env", "CLAUDE_CONFIG_DIR=/tmp/empty", "claude", "--plugin-dir", "/p"]);
	});
});

describe("herdr-core readiness and Host versions", () => {
	it.each([["claude-code", "2.1.294"], ["pi", "1.0.9"], ["antigravity", "1.3.9"]] as const)("refuses a %s %s that does not report OSC 7501, starting nothing", async (host, version) => {
		const { port, stateFile } = subject({}, {}, version);
		const result = await port.createSession({ ...INPUT, host });
		expect(result).toMatchObject({ ok: false, code: "provider_unavailable" });
		expect(hcCalls(stateFile)).toEqual([]);
	});

	it("keeps a silent session for the user instead of failing, and says how to look at it", async () => {
		const { port, control, stateFile } = subject({ initial_status: null }, { readyTimeoutMs: 100 });
		const result = await port.createSession(INPUT);
		expect(result).toMatchObject({ ok: true, entry_submitted: false, state: "unknown", provenance: "none", handle: expect.stringMatching(/^herdr-core:t1\//) });
		if (result.ok) expect(result.attention).toContain("hc attach t1");
		expect(hcCalls(stateFile).some(call => call[0] === "send" || call[0] === "kill")).toBe(false);
		expect(control.sessionCount()).toBe(1);
	});

	it("submits the entry once on resume after the user answered the silent startup dialog", async () => {
		const { port, control, stateFile } = subject({ initial_status: null }, { readyTimeoutMs: 100 });
		const created = await port.createSession(INPUT);
		if (!created.ok) throw new Error(created.reason);
		expect(await port.createSession({ ...INPUT, resume: created.handle })).toMatchObject({ ok: false, code: "state_refused" });
		control.setState(created.handle, "idle");
		expect(await port.createSession({ ...INPUT, resume: created.handle })).toMatchObject({ ok: true, entry_submitted: true, handle: created.handle });
		expect(control.submitted(created.handle)).toEqual([INPUT.entry]);
		expect(hcCalls(stateFile).filter(call => call[0] === "run")).toHaveLength(1);
	});

	it("keeps waiting across core's own check-ins when the Parent set no bound", async () => {
		const { port, control } = subject({ default_wait_seconds: 0.05 });
		const created = await port.createSession(INPUT);
		if (!created.ok) throw new Error(created.reason);
		setTimeout(() => control.setState(created.handle, "done"), 300);
		expect(await port.awaitTransition(created.handle)).toEqual({ ok: true, transition: "changed", state: "done", provenance: "reported" });
	});
});

describe("herdr-core viewer tab inside Herdr", () => {
	type ViewerCall = { cwd: string; label: string; argv: string[]; env?: Record<string, string> };
	function watched(result: { ok: true } | { ok: false; code: "start_failed"; reason: string } = { ok: true }, extra: Record<string, unknown> = {}, readyTimeoutMs?: number) {
		const calls: ViewerCall[] = [];
		const made = subject(extra, { viewer: async (input) => { calls.push(input); return result; }, ...(readyTimeoutMs ? { readyTimeoutMs } : {}) });
		return { ...made, calls };
	}

	it("opens one unfocused viewer per new session running hc attach, with the Parent's core selection", async () => {
		const { port, calls, env } = watched();
		env.HC_SESSION = "imm-probe";
		const { port: selected, calls: selectedCalls } = (() => {
			const seen: ViewerCall[] = [];
			return { port: createHerdrCoreSessionProvider({ env, pollMs: 10, viewer: async (input) => { seen.push(input); return { ok: true }; } }), calls: seen };
		})();
		const created = await port.createSession(INPUT);
		expect(created).toMatchObject({ ok: true, entry_submitted: true, viewer: { opened: true } });
		expect(calls).toHaveLength(1);
		expect(calls[0]).toMatchObject({ cwd: "/lanes/slice-a", label: expect.stringMatching(/^s1-slice-a-[0-9a-f]{12} \(hc t1\)$/), argv: ["hc", "attach", "t1"] });
		await selected.createSession(INPUT);
		expect(selectedCalls[0]!.env).toMatchObject({ HC_SESSION: "imm-probe" });
		if (!created.ok) throw new Error(created.reason);
		// Resuming does not open a second viewer.
		await port.createSession({ ...INPUT, resume: created.handle });
		expect(calls).toHaveLength(1);
	});

	it("keeps the session when the viewer cannot open, and says why", async () => {
		const { port } = watched({ ok: false, code: "start_failed", reason: "herdr tab create failed: x" });
		expect(await port.createSession(INPUT)).toMatchObject({ ok: true, entry_submitted: true, viewer: { opened: false, reason: "herdr tab create failed: x" } });
	});

	it("points a silent startup at the viewer tab instead of hc attach", async () => {
		const { port } = watched({ ok: true }, { initial_status: null }, 100);
		const result = await port.createSession(INPUT);
		expect(result).toMatchObject({ ok: true, entry_submitted: false, viewer: { opened: true } });
		if (result.ok) expect(result.attention).toContain("in its viewer tab");
	});

	it("attaches again only to a session it owns that is still running, with matching viewer tab label", async () => {
		const { port, calls, control } = watched();
		const created = await port.createSession(INPUT);
		if (!created.ok) throw new Error(created.reason);
		expect(await port.attachSession!(created.handle)).toEqual({ ok: true });
		expect(calls).toHaveLength(2);
		expect(calls[1]!.label).toBe(calls[0]!.label);
		expect(await port.attachSession!(control.foreignHandle!())).toMatchObject({ ok: false, code: "not_owned" });
		control.exit(created.handle);
		expect(await port.attachSession!(created.handle)).toMatchObject({ ok: false, code: "state_refused" });
		expect(calls).toHaveLength(2);
	});

	it("creates concurrent live sessions with identical label and distinct viewer tab labels", async () => {
		const { port, calls, control } = watched();
		const first = await port.createSession(INPUT);
		if (!first.ok) throw new Error(first.reason);
		const second = await port.createSession(INPUT);
		if (!second.ok) throw new Error(second.reason);
		expect(second.handle).not.toBe(first.handle);
		expect(control.sessionCount()).toBe(2);
		expect(calls).toHaveLength(2);
		expect(calls[0]!.label).toMatch(/^s1-slice-a-[0-9a-f]{12} \(hc t1\)$/);
		expect(calls[1]!.label).toMatch(/^s1-slice-a-[0-9a-f]{12} \(hc t2\)$/);
		expect(calls[0]!.label).not.toBe(calls[1]!.label);
	});

	it("outside Herdr opens nothing and names hc attach", async () => {
		const { port } = subject({ initial_status: null }, { readyTimeoutMs: 100 });
		const created = await port.createSession(INPUT);
		expect(created).not.toHaveProperty("viewer");
		if (!created.ok) throw new Error(created.reason);
		expect(await port.attachSession!(created.handle)).toMatchObject({ ok: false, code: "provider_unavailable", reason: expect.stringContaining("hc attach t1") });
	});
});

describe("herdr-core admission fails closed", () => {
	it.each([
		["an older core", { version: "0.1.18" }, "protocol_mismatch"],
		["another protocol generation", { generation: 2 }, "protocol_mismatch"],
		["a missing method", { methods: ["terminal.run", "terminal.get"] }, "protocol_mismatch"],
		["no running server", { server_down: true }, "provider_unavailable"],
	] as const)("refuses %s", async (_name, state, code) => {
		const { port } = subject(state as Record<string, unknown>);
		expect(await port.probe()).toMatchObject({ ok: false, code });
	});

	it("is unavailable when no hc executable is on PATH", async () => {
		const { env } = subject();
		expect(await createHerdrCoreSessionProvider({ env: { ...env, PATH: "/nonexistent" } }).probe()).toMatchObject({ ok: false, code: "provider_unavailable" });
	});

	it("is selected only by name through imm-session", async () => {
		const { env } = subject();
		const out = await runSessionCli(["probe", "--provider", "herdr-core"], env);
		expect(out.returncode).toBe(0);
		expect(JSON.parse(out.stdout)).toMatchObject({ ok: true, provider: "herdr-core" });
	});
});
