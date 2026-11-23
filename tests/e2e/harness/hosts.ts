// Host pinning, Host launch arguments and the fake-herdr process control for the L1
// journeys (Spec e2e-release-gate D3, D4). Black box: it drives the `herdr` CLI and the
// Host binaries as processes and never imports a plugin runtime module.

import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";

const E2E_DIR = resolve(import.meta.dir, "..");
const FAKE_HERDR_DIR = resolve(E2E_DIR, "../fixtures/fake-herdr");

export interface HostPins {
	claude: { pinned: string; minimum: string };
	pi: { pinned: string };
}
export const loadHostPins = (): HostPins => JSON.parse(readFileSync(join(E2E_DIR, "hosts.json"), "utf8"));

export type HostFailureCode = "host_binary_missing" | "host_version_mismatch" | "host_timeout" | "host_failed";
export class HostError extends Error {
	constructor(readonly code: HostFailureCode, message: string) {
		super(`${code}: ${message}`);
	}
}

/** The allowlisted environment every child starts from; no inherited HERDR_*, CLAUDE_* or ANTHROPIC_*. */
export function baseEnv(): Record<string, string> {
	const env: Record<string, string> = {};
	for (const key of ["PATH", "TMPDIR", "LANG", "LC_ALL", "TZ"]) if (process.env[key]) env[key] = process.env[key] as string;
	return env;
}

async function capture(command: string[], env: Record<string, string>, timeoutMs = 60_000): Promise<{ code: number; stdout: string; stderr: string }> {
	const child = Bun.spawn(command, { stdout: "pipe", stderr: "pipe", env });
	const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
	const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
	clearTimeout(timer);
	return { code, stdout, stderr };
}

/** The pinned claude binary. An absent or differently-versioned binary is a failure, never a skip. */
export async function resolveClaude(): Promise<{ bin: string; version: string }> {
	const pins = loadHostPins();
	const bin = process.env.E2E_CLAUDE_BIN || Bun.which("claude", { PATH: baseEnv().PATH }) || "";
	if (!bin || !existsSync(bin)) throw new HostError("host_binary_missing", `claude ${pins.claude.pinned} is not installed (looked for ${process.env.E2E_CLAUDE_BIN || "claude on PATH"})`);
	const { stdout } = await capture([bin, "--version"], baseEnv());
	const version = stdout.trim().split(/\s+/)[0];
	if (version !== pins.claude.pinned) throw new HostError("host_version_mismatch", `claude ${version} found, tests/e2e/hosts.json pins ${pins.claude.pinned}`);
	return { bin, version };
}

export interface ClaudeLaunchInput {
	bin: string;
	pluginDir: string;
	modelUrl: string;
	prompt: string;
	/** Scratch directory that becomes HOME and CLAUDE_CONFIG_DIR, so no user login or settings load. */
	homeDir: string;
	/** A real key only when recording; replays use a placeholder the mock never checks. */
	apiKey?: string;
}
export interface HostLaunch {
	command: string[];
	env: Record<string, string>;
}

export function claudeLaunch(input: ClaudeLaunchInput): HostLaunch {
	return {
		command: [input.bin, "-p", input.prompt, "--plugin-dir", input.pluginDir, "--output-format", "stream-json", "--verbose"],
		env: {
			HOME: input.homeDir,
			CLAUDE_CONFIG_DIR: join(input.homeDir, ".claude"),
			ANTHROPIC_BASE_URL: input.modelUrl,
			ANTHROPIC_API_KEY: input.apiKey ?? "sk-ant-e2e-mock",
			DISABLE_AUTOUPDATER: "1",
			DISABLE_TELEMETRY: "1",
			CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
		},
	};
}

/**
 * Puts `claude` and `pi` stand-ins first on PATH (see host-shim.ts): a Host the runtime starts by
 * bare name inside a pane reaches the pinned real binary only after the entry prompt arrives.
 */
export function makeHostShims(dir: string): string {
	mkdirSync(dir, { recursive: true });
	for (const name of ["claude", "pi"]) {
		const path = join(dir, name);
		writeFileSync(path, `#!/bin/sh\nexec "${process.execPath}" "${join(import.meta.dir, "host-shim.ts")}" ${name} "$@"\n`);
		chmodSync(path, 0o755);
	}
	return dir;
}

export interface ClaudeStream {
	events: Array<Record<string, any>>;
	init?: Record<string, any>;
	result?: Record<string, any>;
}
export function parseClaudeStream(output: string): ClaudeStream {
	const events = output.split("\n").filter((line) => line.startsWith("{")).flatMap((line) => {
		try { return [JSON.parse(line)]; } catch { return []; }
	});
	return {
		events,
		init: events.find((event) => event.type === "system" && event.subtype === "init"),
		result: events.find((event) => event.type === "result"),
	};
}

export interface HerdrEvent {
	at: string;
	event: "create" | "start" | "attention" | "stop" | "exit" | "pane_not_found";
	pane?: string;
	[key: string]: unknown;
}

/** One fake-herdr in spawning mode: Host panes run as real child processes. */
export class FakeHerdr {
	readonly stateFile: string;
	readonly eventLog: string;
	private readonly env: Record<string, string>;

	private constructor(private readonly dir: string, private readonly workspace: string, private readonly extraEnv: Record<string, string> = {}, pathPrefix = "") {
		this.stateFile = join(dir, "state.json");
		this.eventLog = join(dir, "events.jsonl");
		writeFileSync(this.stateFile, JSON.stringify({ protocol: 22, panes: {}, spawn: true, event_log: this.eventLog }));
		writeFileSync(this.eventLog, "");
		// The harness owns every HERDR_* variable the Host sees: none is inherited.
		this.env = { ...baseEnv(), PATH: `${pathPrefix ? pathPrefix + delimiter : ""}${FAKE_HERDR_DIR}${delimiter}${baseEnv().PATH ?? ""}`, FAKE_HERDR_STATE: this.stateFile, HERDR_ENV: "1", HERDR_WORKSPACE_ID: workspace, ...extraEnv };
	}

	/** `extraEnv` reaches every Host the fake spawns (the fake's own environment is what spawned children inherit). */
	static create(workspace = "w-e2e", extraEnv: Record<string, string> = {}, pathPrefix = ""): FakeHerdr {
		return new FakeHerdr(mkdtempSync(join(tmpdir(), "imm-e2e-herdr-")), workspace, extraEnv, pathPrefix);
	}

	/** The Herdr-facing environment a Host started outside fake-herdr's spawn (the Parent pane) needs to be "inside Herdr". */
	paneEnv(): Record<string, string> {
		const { PATH, FAKE_HERDR_STATE, HERDR_ENV, HERDR_WORKSPACE_ID } = this.env;
		return { ...this.extraEnv, PATH, FAKE_HERDR_STATE, HERDR_ENV, HERDR_WORKSPACE_ID, E2E_HERDR_STATE: this.stateFile };
	}

	run(argv: string[], timeoutMs?: number) {
		return capture([join(FAKE_HERDR_DIR, "herdr"), ...argv], this.env, timeoutMs);
	}

	private async result(argv: string[]): Promise<any> {
		const { code, stdout, stderr } = await this.run(argv);
		if (code !== 0) throw new Error(`herdr ${argv.join(" ")} failed: ${stderr.trim()}`);
		return JSON.parse(stdout).result;
	}

	/** Creates a tab and starts the Host command in its pane, the way the Lane runtime does. */
	async launch(input: { label: string; cwd: string; launch: HostLaunch; kind?: string }): Promise<{ tab: string; pane: string }> {
		const env = Object.entries(input.launch.env).flatMap(([key, value]) => ["--env", `${key}=${value}`]);
		const created = await this.result(["tab", "create", "--workspace", this.workspace, "--cwd", input.cwd, "--label", input.label, ...env, "--no-focus"]);
		const pane = created.root_pane.pane_id as string;
		await this.result(["agent", "start", input.label, "--kind", input.kind ?? "claude", "--pane", pane, "--", ...input.launch.command]);
		return { tab: created.tab.tab_id, pane };
	}

	/** Waits for the Host process to end; returns its exit code from the lifecycle log. */
	async waitForExit(pane: string, timeoutMs: number): Promise<number | null> {
		const waited = await this.run(["agent", "wait", pane, "--until", "done", "--until", "unknown", "--until", "blocked", "--timeout", String(timeoutMs)], timeoutMs + 15_000);
		if (waited.code !== 0) throw new HostError("host_timeout", `pane ${pane} did not finish within ${timeoutMs} ms: ${waited.stderr.trim()}`);
		const ended = this.events().find((event) => event.event === "exit" && event.pane === pane);
		return (ended?.code as number | null | undefined) ?? null;
	}

	async output(pane: string): Promise<string> {
		return (await this.run(["pane", "read", pane])).stdout;
	}

	events(): HerdrEvent[] {
		return readFileSync(this.eventLog, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));
	}

	/** Kills every Host child (whole process group) and removes the state. */
	teardown(): void {
		try {
			const state = JSON.parse(readFileSync(this.stateFile, "utf8"));
			for (const pane of Object.values<any>(state.panes ?? {})) {
				if (pane.supervisor_pid) {
					try { process.kill(-pane.supervisor_pid, "SIGKILL"); } catch { /* already gone */ }
				}
			}
		} catch { /* state already removed */ }
		rmSync(this.dir, { recursive: true, force: true });
	}
}
