// Herdr adapter specifics beyond the shared conformance suite (ADR 0038):
// the exact `herdr` commands it spells, fail-closed admission, and the
// `imm-session` CLI that the Parent's Loop contract invokes.

import { afterEach, describe, expect, it } from "bun:test";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { resolveConfig } from "../plugins/immune-brain/runtime/config/layered_config";
import { EXECUTOR_HOSTS } from "../plugins/immune-brain/runtime/session/supervised_session_port";
import { runSessionCli } from "../plugins/immune-brain/runtime/session/cli";
import { createHerdrSessionProvider, herdrAgentName, parseHerdrState } from "../plugins/immune-brain/runtime/session/herdr_provider";
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

/** Calls that act, without the ownership reads every verb makes first. */
const acting = (calls: string[][]) => calls.filter(call => !(call[1] === "get" && (call[0] === "pane" || call[0] === "tab")));
const tokenOf = (handle: string) => decodeURIComponent(handle.split("/")[3]);
const PROOF = { task_id: "slice-a", recorded_at: "2020-01-01T00:00:00.000Z" };

describe("Herdr adapter command spelling", () => {
	it("creates the tab in the Parent's workspace without focus and marked with the session token, starts the Host by kind and waits until working or blocked", async () => {
		const { port, stateFile } = subject();
		const result = await port.createSession(INPUT);
		if (!result.ok) throw new Error(result.reason);
		const token = tokenOf(result.handle);
		expect(token).toMatch(/^[0-9a-f]{12}$/);
		expect(result.handle).toBe(`herdr:w-parent/t1/p1/${token}`);
		expect(herdrCalls(stateFile)).toEqual([
			["tab", "create", "--workspace", "w-parent", "--cwd", "/lanes/slice-a", "--label", `slice-a [imm:${token}]`, "--no-focus"],
			["agent", "start", "slice-a", "--kind", "pi", "--pane", "p1", "--", "--model", "m1"],
			["agent", "prompt", "p1", "/drive slice-a", "--wait", "--until", "working", "--until", "blocked", "--timeout", "30000"],
		]);
	});

	it("checks the pane and the tab token before every verb", async () => {
		const { port, control, stateFile } = subject();
		const created = await port.createSession(INPUT);
		if (!created.ok) throw new Error(created.reason);
		control.setState(created.handle, "idle");
		await port.sendInstruction(created.handle, "hold the invariant");
		control.setState(created.handle, "idle");
		await port.awaitTransition(created.handle);
		expect(herdrCalls(stateFile).slice(3)).toEqual([
			["pane", "get", "p1"], ["tab", "get", "t1"],
			["agent", "get", "p1"],
			["agent", "prompt", "p1", "hold the invariant", "--wait", "--until", "working", "--until", "blocked", "--timeout", "30000"],
			["pane", "get", "p1"], ["tab", "get", "t1"],
			["agent", "wait", "p1", "--until", "idle", "--until", "done", "--until", "blocked", "--until", "unknown"],
		]);
	});

	it("stops with a soft interrupt then closes the pane, and closes a session by its tab", async () => {
		const { port, stateFile } = subject();
		const created = await port.createSession(INPUT);
		if (!created.ok) throw new Error(created.reason);
		await port.stopSession(created.handle);
		await port.closeSession(created.handle, PROOF);
		expect(acting(herdrCalls(stateFile)).slice(3)).toEqual([
			["agent", "send-keys", "p1", "ctrl+c"],
			["pane", "close", "p1"],
			["tab", "close", "t1"],
		]);
	});

	it("passes --env to the new tab's shell", async () => {
		const { port, stateFile } = subject();
		expect(await port.createSession({ ...INPUT, env: { PI_PROGRAM_STATUS: "0", A: "x=y" } })).toMatchObject({ ok: true });
		expect(herdrCalls(stateFile)[0].slice(-5)).toEqual(["--env", "PI_PROGRAM_STATUS=0", "--env", "A=x=y", "--no-focus"]);
		expect(await port.createSession({ ...INPUT, env: { "BAD-NAME": "1" } })).toMatchObject({ ok: false, code: "invalid_input" });
	});

	it("reads .result.agent.agent_status and treats anything else as unknown", () => {
		expect(parseHerdrState('{"id":"x","result":{"agent":{"agent_status":"blocked"}}}')).toBe("blocked");
		expect(parseHerdrState('{"id":"x","result":{"agent":{"agent_status":"thinking"}}}')).toBe("unknown");
		expect(parseHerdrState('{"agent":{"agent_status":"idle"}}')).toBe("unknown");
		expect(parseHerdrState("idle\n")).toBe("unknown");
		expect(parseHerdrState("")).toBe("unknown");
	});

	it("folds a tab label into a valid Herdr agent name", async () => {
		expect(herdrAgentName("S0a")).toBe("s0a");
		expect(herdrAgentName("01 Slice/A")).toBe("slice-a");
		expect(herdrAgentName("___")).toBe("lane");
		expect(herdrAgentName(`a${"b".repeat(40)}`)).toHaveLength(32);
		const { port, stateFile } = subject();
		expect(await port.createSession({ ...INPUT, label: "S0a" })).toMatchObject({ ok: true, entry_submitted: true });
		expect(herdrCalls(stateFile)[1].slice(0, 3)).toEqual(["agent", "start", "s0a"]);
	});

	it("wakes a wait when Herdr can no longer classify the session", async () => {
		const { port, control } = subject();
		const created = await port.createSession(INPUT);
		if (!created.ok) throw new Error(created.reason);
		control.setState(created.handle, "unknown");
		expect(await port.awaitTransition(created.handle, { timeoutMs: 2_000 })).toEqual({ ok: true, transition: "changed", state: "unknown", provenance: "none" });
	});
});

describe("Executor Host coverage", () => {
	it.each([["claude-code", "claude"], ["pi", "pi"], ["antigravity", "agy"]] as const)("starts a %s Executor as Herdr kind %s", async (host, kind) => {
		const { port, stateFile } = subject();
		expect(await port.createSession({ ...INPUT, host })).toMatchObject({ ok: true, entry_submitted: true });
		expect(acting(herdrCalls(stateFile))[1].slice(0, 5)).toEqual(["agent", "start", "slice-a", "--kind", kind]);
	});

	it("launches only Executor Hosts the Lane configuration accepts", () => {
		const root = mkdtempSync(join(tmpdir(), "imm-session-hosts-"));
		try {
			execFileSync("git", ["init", "-q", root]);
			mkdirSync(join(root, ".imm"));
			const accepted = (host: string) => {
				writeFileSync(join(root, ".imm/config.json"), JSON.stringify({ contract: "immune_brain/project_config/v1", lanes: { executor_host: host } }));
				execFileSync("git", ["add", ".imm/config.json"], { cwd: root });
				return !resolveConfig(root, { userConfigPath: join(root, "absent-user.json") }).diagnostics.some(d => d.key_path === "lanes.executor_host");
			};
			for (const host of EXECUTOR_HOSTS) expect({ host, accepted: accepted(host) }).toEqual({ host, accepted: true });
			expect(accepted("codex")).toBe(false);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});

describe("Herdr adapter runCommand (#426 S4)", () => {
	it("runs the command in a token-marked tab and returns its real exit status", async () => {
		const { port, stateFile } = subject();
		const cwd = mkdtempSync(join(tmpdir(), "imm-run-"));
		try {
			const result = await port.runCommand!({ cwd, label: "review t", argv: ["sh", "-c", "echo \"it's here\" > out.txt; exit 3"] });
			expect(result).toMatchObject({ ok: true, exit_code: 3 });
			expect(readFileSync(join(cwd, "out.txt"), "utf8")).toBe("it's here\n");
			const calls = herdrCalls(stateFile);
			expect(calls[0][7]).toMatch(/^review t \[imm:[0-9a-f]{12}\]$/);
			// The typed line carries no literal sentinel, so its echo cannot end the wait.
			const typed = calls.find((call) => call[1] === "run")![3];
			const regex = calls.find((call) => call[1] === "wait-output")![4];
			expect(new RegExp(regex).test(typed)).toBe(false);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("is offered through imm-session run, and refused by a provider without it", async () => {
		const { env } = subject();
		const cwd = mkdtempSync(join(tmpdir(), "imm-run-"));
		try {
			const out = await runSessionCli(["run", "--provider", "herdr", "--cwd", cwd, "--label", "x", "--", "true"], env);
			expect(JSON.parse(out.stdout)).toMatchObject({ ok: true, exit_code: 0 });
			expect((await runSessionCli(["run", "--provider", "herdr", "--cwd", cwd, "--label", "x"], env)).returncode).toBe(2);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});
});

describe("Herdr adapter ownership (K1)", () => {
	/** Adds a tab and pane of the user's own to the stand-in, in the Parent's workspace. */
	const userPane = (stateFile: string, label: string) => {
		const state = JSON.parse(readFileSync(stateFile, "utf8"));
		state.tabs ??= {};
		state.tabs.t9 = { workspace: "w-parent", label };
		state.panes.p9 = { tab: "t9", workspace: "w-parent", agent: true, state: "idle", prompts: [], keys: [], output: "", closed: false, starts: 1 };
		writeFileSync(stateFile, JSON.stringify(state));
	};

	it("refuses every verb on a pane of the Parent's own workspace that it did not create", async () => {
		const { port, stateFile } = subject();
		userPane(stateFile, "my shell");
		const handle = "herdr:w-parent/t9/p9/guessed";
		for (const result of [
			await port.observeState(handle),
			await port.sendInstruction(handle, "x"),
			await port.awaitTransition(handle, { timeoutMs: 50 }),
			await port.readOutput(handle, "visible"),
			await port.stopSession(handle),
			await port.closeSession(handle, PROOF),
			await port.createSession({ ...INPUT, resume: handle }),
		]) expect(result).toMatchObject({ ok: false, code: "not_owned" });
		expect(acting(herdrCalls(stateFile))).toEqual([]);
	});

	it("refuses a guessed token and a pane borrowed from another tab", async () => {
		const { port, stateFile } = subject();
		const created = await port.createSession(INPUT);
		if (!created.ok) throw new Error(created.reason);
		const token = tokenOf(created.handle);
		userPane(stateFile, "my shell");
		expect(await port.observeState("herdr:w-parent/t1/p1/000000000000")).toMatchObject({ ok: false, code: "not_owned" });
		expect(await port.observeState(`herdr:w-parent/t1/p9/${token}`)).toMatchObject({ ok: false, code: "not_owned" });
		expect(await port.stopSession(`herdr:w-parent/t1/p9/${token}`)).toMatchObject({ ok: false, code: "not_owned" });
		expect(acting(herdrCalls(stateFile)).slice(3)).toEqual([]);
	});

	it("refuses a handle in the old three-part form", async () => {
		const { port } = subject();
		expect(await port.observeState("herdr:w-parent/t1/p1")).toMatchObject({ ok: false, code: "not_owned" });
	});
});

describe("Herdr adapter resume (C-2)", () => {
	const hostExit = (stateFile: string, pane: string) => {
		const state = JSON.parse(readFileSync(stateFile, "utf8"));
		Object.assign(state.panes[pane], { agent: false, state: "unknown" });
		writeFileSync(stateFile, JSON.stringify(state));
	};

	it("restarts an exited Host in the same pane and submits the entry once", async () => {
		const { port, control, stateFile } = subject();
		const created = await port.createSession(INPUT);
		if (!created.ok) throw new Error(created.reason);
		hostExit(stateFile, "p1");
		expect(await port.observeState(created.handle)).toEqual({ ok: true, state: "unknown", provenance: "none" });
		expect(await port.createSession({ ...INPUT, resume: created.handle })).toMatchObject({ ok: true, handle: created.handle, entry_submitted: true, state: "working" });
		expect(control.sessionCount()).toBe(1);
		expect(control.submitted(created.handle)).toEqual([INPUT.entry, INPUT.entry]);
		expect(acting(herdrCalls(stateFile)).slice(3)).toEqual([
			["agent", "get", "p1"],
			["agent", "get", "p1"],
			["agent", "start", "slice-a", "--kind", "pi", "--pane", "p1", "--", "--model", "m1"],
			["agent", "prompt", "p1", INPUT.entry, "--wait", "--until", "working", "--until", "blocked", "--timeout", "30000"],
		]);
	});

	it("reports a restart dialog as blocked without submitting the entry", async () => {
		const { port, control, stateFile } = subject();
		const created = await port.createSession(INPUT);
		if (!created.ok) throw new Error(created.reason);
		hostExit(stateFile, "p1");
		control.blockNextStart();
		expect(await port.createSession({ ...INPUT, resume: created.handle })).toMatchObject({ ok: true, entry_submitted: false, state: "blocked" });
		expect(control.submitted(created.handle)).toEqual([INPUT.entry]);
	});

	it("refuses to resume a session whose pane is gone, sending nothing", async () => {
		const { port, stateFile } = subject();
		const created = await port.createSession(INPUT);
		if (!created.ok) throw new Error(created.reason);
		await port.stopSession(created.handle);
		const before = acting(herdrCalls(stateFile)).length;
		expect(await port.createSession({ ...INPUT, resume: created.handle })).toMatchObject({ ok: false, code: "state_refused" });
		expect(await port.sendInstruction(created.handle, "x")).toMatchObject({ ok: false, code: "state_refused" });
		expect(acting(herdrCalls(stateFile)).length).toBe(before);
	});
});

describe("Herdr adapter refusal mapping", () => {
	it("reports Herdr's own agent_blocked refusal as state_refused when the session blocked after it was observed idle", async () => {
		const env = { HERDR_ENV: "1", HERDR_WORKSPACE_ID: "w" };
		const handle = "herdr:w/t1/p1/abc";
		const reply = (result: unknown) => ({ code: 0, stdout: JSON.stringify({ id: "x", result }), stderr: "" });
		const port = createHerdrSessionProvider({
			env,
			exec: async args => {
				if (args[0] === "pane" && args[1] === "get") return reply({ type: "pane_info", pane: { pane_id: "p1", tab_id: "t1", workspace_id: "w" } });
				if (args[0] === "tab" && args[1] === "get") return reply({ type: "tab_info", tab: { tab_id: "t1", label: "a [imm:abc]" } });
				if (args[1] === "get") return reply({ agent: { agent_status: "idle" } });
				return { code: 1, stdout: "", stderr: '{"id":"p","error":{"code":"agent_blocked","message":"agent is blocked"}}' };
			},
		});
		expect(await port.sendInstruction(handle, "x")).toMatchObject({ ok: false, code: "state_refused", handle });
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
		for (const provider of [undefined, "herdr-tui", "fake"]) {
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
		expect(herdrCalls(stateFile)).toEqual([["api", "schema", "--json"]]);
	});

	it("parses repeated --env KEY=VALUE for create only", async () => {
		const { env, stateFile } = subject();
		const base = ["create", "--provider", "herdr", "--cwd", "/l", "--label", "a", "--host", "pi", "--entry", "/drive a"];
		expect((await runSessionCli([...base, "--env", "A=1", "--env", "B=x=y"], env)).returncode).toBe(0);
		expect(herdrCalls(stateFile).find(call => call[1] === "create")).toContain("B=x=y");
		for (const bad of [["--env", "NOEQUALS"], ["--env", "=v"], ["--env", "A=1", "--env", "A=2"]]) {
			expect((await runSessionCli([...base, ...bad], env)).returncode).toBe(2);
		}
		expect((await runSessionCli(["observe", "herdr:w-parent/t1/p1/x", "--provider", "herdr", "--env", "A=1"], env)).returncode).toBe(2);
	});

	it("awaits several sessions, returns the first transition with its handle, and leaves no wait process behind (C-3)", async () => {
		const { port, control, env } = subject();
		const first = await port.createSession(INPUT);
		const second = await port.createSession({ ...INPUT, label: "slice-b" });
		if (!first.ok || !second.ok) throw new Error("create refused");
		setTimeout(() => control.setState(second.handle, "blocked"), 300);
		const out = await runSessionCli(["await", first.handle, second.handle, "--provider", "herdr"], env);
		expect(out.returncode).toBe(0);
		expect(JSON.parse(out.stdout)).toEqual({ ok: true, transition: "changed", state: "blocked", provenance: "detected", handle: second.handle });
		const lingering = spawnSync("pgrep", ["-f", "herdr agent wait p1 "], { encoding: "utf8" });
		expect(lingering.stdout.trim()).toBe("");
	});

	it("reports a shared timeout without naming a handle", async () => {
		const { port, env } = subject();
		const first = await port.createSession(INPUT);
		const second = await port.createSession({ ...INPUT, label: "slice-b" });
		if (!first.ok || !second.ok) throw new Error("create refused");
		const out = await runSessionCli(["await", first.handle, second.handle, "--provider", "herdr", "--timeout-ms", "150"], env);
		expect(JSON.parse(out.stdout)).toEqual({ ok: true, transition: "timeout", state: "unknown", provenance: "none" });
		expect((await runSessionCli(["await", first.handle, first.handle, "--provider", "herdr"], env)).returncode).toBe(2);
	});

	// S1 + F2: the proof is the batch's own run state, not a well-formed pair of flags.
	it("closes only a session whose close the batch record lists (S1, F2)", async () => {
		const { port, env, stateFile } = subject();
		const created = await port.createSession(INPUT);
		if (!created.ok) throw new Error(created.reason);
		const root = mkdtempSync(join(tmpdir(), "imm-session-close-"));
		const at = "2020-01-01T00:00:00.000Z";
		const writeRecord = (closes: unknown[]) => {
			mkdirSync(join(root, ".imm/state/batches"), { recursive: true });
			writeFileSync(join(root, ".imm/state/batches/batch-one.json"), JSON.stringify({ batch_id: "batch-one", session_closes: closes }));
		};
		const close = (...extra: string[]) => runSessionCli(["close", created.handle, "--provider", "herdr", ...extra], env, undefined, root);
		const refusal = async (...extra: string[]) => JSON.parse((await close(...extra)).stdout);
		try {
			expect((await close("--task", "slice-a", "--recorded-at", at)).returncode).toBe(2);
			expect(await refusal("--batch", "batch-one", "--task", "slice-a", "--recorded-at", "now")).toMatchObject({ ok: false, code: "close_unproven" });
			// Well-formed but unrecorded: no record file, then a record without this close.
			expect(await refusal("--batch", "batch-one", "--task", "slice-a", "--recorded-at", at)).toMatchObject({ ok: false, code: "close_unproven" });
			writeRecord([{ task_id: "slice-b", at }, { task_id: "slice-a", at: "2020-01-02T00:00:00.000Z" }]);
			expect(await refusal("--batch", "batch-one", "--task", "slice-a", "--recorded-at", at)).toMatchObject({ ok: false, code: "close_unproven" });
			expect(acting(herdrCalls(stateFile)).some((c) => c[1] === "close")).toBe(false);
			writeRecord([{ task_id: "slice-a", at }]);
			expect(await refusal("--batch", "batch-one", "--task", "slice-a", "--recorded-at", at)).toEqual({ ok: true });
			expect(acting(herdrCalls(stateFile)).at(-1)).toEqual(["tab", "close", "t1"]);
		} finally { rmSync(root, { recursive: true, force: true }); }
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
