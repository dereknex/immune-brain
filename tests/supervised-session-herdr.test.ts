// Herdr adapter specifics beyond the shared conformance suite (ADR 0038):
// the exact `herdr` commands it spells, fail-closed admission, and the
// `imm-session` CLI that the Parent's Loop contract invokes.

import { afterEach, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { runSessionCli } from "../plugins/immune-brain/runtime/session/cli";
import { createHerdrSessionProvider, parseHerdrState } from "../plugins/immune-brain/runtime/session/herdr_provider";
import { herdrCalls, herdrSubject } from "./helpers/fake-herdr";

const INPUT = { cwd: "/lanes/slice-a", label: "slice-a", host: "pi" as const, hostArgs: ["--model", "m1"], entry: "/drive slice-a" };
const REPO_ROOT = resolve(__dirname, "..");

let cleanup: (() => void) | undefined;
afterEach(() => { cleanup?.(); cleanup = undefined; });
function subject(extra: Record<string, unknown> = {}) {
	const made = herdrSubject(extra);
	cleanup = made.cleanup;
	return made;
}

describe("Herdr adapter command spelling", () => {
	it("creates the tab in the Parent's workspace without focus, starts the Host by kind and waits until working or blocked", async () => {
		const { port, stateFile } = subject();
		const result = await port.createSession(INPUT);
		expect(result).toMatchObject({ ok: true, handle: "herdr:w-parent/t1/p1" });
		expect(herdrCalls(stateFile)).toEqual([
			["tab", "create", "--workspace", "w-parent", "--cwd", "/lanes/slice-a", "--label", "slice-a", "--no-focus"],
			["agent", "start", "slice-a", "--kind", "pi", "--pane", "p1", "--", "--model", "m1"],
			["agent", "prompt", "p1", "/drive slice-a", "--wait", "--until", "working", "--until", "blocked", "--timeout", "30000"],
		]);
	});

	it("observes before it sends an instruction and arms the wait on the pane", async () => {
		const { port, control, stateFile } = subject();
		const created = await port.createSession(INPUT);
		if (!created.ok) throw new Error(created.reason);
		control.setState(created.handle, "idle");
		await port.sendInstruction(created.handle, "hold the invariant");
		control.setState(created.handle, "idle");
		await port.awaitTransition(created.handle);
		expect(herdrCalls(stateFile).slice(3)).toEqual([
			["agent", "get", "p1"],
			["agent", "prompt", "p1", "hold the invariant", "--wait", "--until", "working", "--until", "blocked", "--timeout", "30000"],
			["agent", "wait", "p1"],
		]);
	});

	it("stops with a soft interrupt then closes the pane, and closes a session by its tab", async () => {
		const { port, stateFile } = subject();
		const created = await port.createSession(INPUT);
		if (!created.ok) throw new Error(created.reason);
		await port.stopSession(created.handle);
		await port.closeSession(created.handle, { created_by_parent: true, child_integrated: true, release_handoff_issued: true, audit_pair_reachable: true, record: "r" });
		expect(herdrCalls(stateFile).slice(3)).toEqual([
			["agent", "send-keys", "p1", "ctrl+c"],
			["pane", "close", "p1"],
			["tab", "close", "t1"],
		]);
	});

	it("reads only states Herdr names and treats anything else as unknown", () => {
		expect(parseHerdrState('{"agent":{"state":"Blocked"}}')).toBe("blocked");
		expect(parseHerdrState('{"status":"idle"}')).toBe("idle");
		expect(parseHerdrState("working\n")).toBe("working");
		expect(parseHerdrState('{"agent":{"state":"thinking"}}')).toBe("unknown");
		expect(parseHerdrState("")).toBe("unknown");
	});
});

describe("Herdr adapter admission fails closed", () => {
	it("is unavailable outside Herdr or without the Parent's workspace", async () => {
		const { env } = subject();
		expect(await createHerdrSessionProvider({ env: { ...env, HERDR_ENV: undefined } }).probe()).toMatchObject({ ok: false, code: "provider_unavailable" });
		expect(await createHerdrSessionProvider({ env: { ...env, HERDR_WORKSPACE_ID: "" } }).probe()).toMatchObject({ ok: false, code: "provider_unavailable" });
	});

	it("is unavailable when no herdr executable is on PATH", async () => {
		const { env } = subject();
		const port = createHerdrSessionProvider({ env: { ...env, PATH: "/nonexistent" } });
		expect(await port.probe()).toMatchObject({ ok: false, code: "provider_unavailable" });
	});

	it("refuses a Herdr protocol it is not pinned to", async () => {
		const { port } = subject({ protocol: 23 });
		expect(await port.probe()).toMatchObject({ ok: false, code: "protocol_mismatch" });
	});
});

describe("imm-session CLI", () => {
	it("requires an explicit provider and never falls back", async () => {
		const { env, stateFile } = subject();
		for (const provider of [undefined, "herdr-core", "fake"]) {
			const args = provider ? ["probe", "--provider", provider] : ["probe"];
			const out = await runSessionCli(args, env);
			expect(out.returncode).toBe(1);
			expect(JSON.parse(out.stdout)).toMatchObject({ ok: false, code: "invalid_input" });
		}
		expect(herdrCalls(stateFile)).toEqual([]);
	});

	it("launches nothing when the provider is unavailable", async () => {
		const { env, stateFile } = subject({ protocol: 19 });
		const out = await runSessionCli(["create", "--provider", "herdr", "--cwd", "/l", "--label", "a", "--host", "pi", "--entry", "/drive a"], env);
		expect(out.returncode).toBe(1);
		expect(JSON.parse(out.stdout)).toMatchObject({ ok: false, code: "protocol_mismatch" });
		expect(herdrCalls(stateFile)).toEqual([["api", "schema"]]);
	});

	it("offers no close verb", async () => {
		const { env } = subject();
		const out = await runSessionCli(["close", "herdr:w-parent/t1/p1", "--provider", "herdr"], env);
		expect(out.returncode).toBe(2);
		expect(out.stderr).toContain("imm-session offers no close");
	});

	it("drives create, observe and await through the packaged wrapper", () => {
		const { env } = subject();
		const bin = resolve(REPO_ROOT, "plugins/immune-brain/bin/imm-session");
		const run = (args: string[]) => spawnSync(bin, args, { env, encoding: "utf8" });
		const created = run(["create", "--provider", "herdr", "--cwd", "/lanes/a", "--label", "a", "--host", "claude-code", "--entry", "/immune-brain:drive a", "--", "--plugin-dir", "/p"]);
		expect(created.status).toBe(0);
		const { handle } = JSON.parse(created.stdout);
		expect(JSON.parse(created.stdout)).toEqual({ ok: true, handle, entry_submitted: true, state: "working", provenance: "detected" });
		const observed = run(["observe", handle, "--provider", "herdr"]);
		expect(JSON.parse(observed.stdout)).toEqual({ ok: true, state: "working", provenance: "detected" });
		const waited = run(["await", handle, "--provider", "herdr", "--timeout-ms", "100"]);
		expect(JSON.parse(waited.stdout)).toEqual({ ok: true, transition: "timeout", state: "unknown", provenance: "none" });
	});
});
