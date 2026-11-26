// J4 install: each Host loads the packed plugin and exposes its Skills, slash commands and MCP
// tools, including under the minimum supported claude version (Spec e2e-release-gate D2/D3,
// S3-AC1). Black box: the Hosts, the extracted tarball and MCP stdio are the only seams.
// Run with `bun run e2e install`; the pinned claude binary must be installed (absent fails, never skips).

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, sep } from "node:path";
import { FakeHerdr, HostError, baseEnv, claudeLaunch, loadHostPins, parseClaudeStream, resolveClaude } from "./harness/hosts";
import { type InstallRoot, createInstallRoot } from "./harness/install-root";
import { assertNoFailures } from "./harness/mock-model";
import { startJourneyModel } from "./harness/recorder";

const PROMPT = "Reply with the scripted install answer.";
const PLUGIN = "plugins/immune-brain";
const ANTIGRAVITY = "plugins/immune-brain-antigravity";

/** The public Skills every Host must expose; each is also a slash command on Claude Code. */
const SKILLS = ["authority-review", "clarify", "draw-up", "drive", "fix-pr", "prune-docs", "prune-tests", "revisit", "slim"];
/** The Kernel MCP tools Claude Code and Antigravity must list (their names are Host-neutral). */
const MCP_TOOLS = [
	"advance_assurance", "approve_breaking_intent_revision", "refute_finding", "repair_authority_state",
	"request_authorization", "resolve_finding", "retire_stale_batch", "revise_intent", "start_unattended_batch", "status",
	"stop", "submit_review", "submit_session_result", "submit_verification",
];
/** The Pi extension's registered tools and command (Pi has no MCP server; it loads .pi-extension). */
const PI_TOOLS = ["imm_kernel_canary", "start_unattended_batch", "retire_stale_batch"];
const PI_COMMANDS = ["imm-tasks"];

let install: InstallRoot;
let claude: { bin: string; version: string };
const scratch: string[] = [];
const tempDir = (prefix: string) => {
	const dir = mkdtempSync(join(tmpdir(), prefix));
	scratch.push(dir);
	return dir;
};

beforeAll(async () => {
	claude = await resolveClaude();
	install = await createInstallRoot();
}, 300_000);
afterAll(() => {
	install?.cleanup();
	for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------------------------
// Declared files and the minimum-version gate (the two negative controls' subjects)
// ---------------------------------------------------------------------------------------------

/** Every file a plugin directory declares (manifest, MCP config, hooks, Skills); throws naming the first absent one. */
function assertDeclaredFiles(packageDir: string, pluginPath: string): string[] {
	const root = join(packageDir, pluginPath);
	const declared = new Set<string>();
	const add = (relative: string) => declared.add(relative.replace(/^\.\//, ""));
	for (const manifest of [".claude-plugin/plugin.json", ".antigravity-plugin/plugin.json"]) if (existsSync(join(root, manifest))) add(manifest);
	for (const config of [".mcp.json", "mcp_config.json", "hooks/hooks.json", "hooks.json"]) {
		if (!existsSync(join(root, config))) continue;
		add(config);
		// Declared commands name plugin files as the plugin-root variable followed by /x, or as ./x.
		for (const match of readFileSync(join(root, config), "utf8").matchAll(/(?:\$\{(?:CLAUDE_)?PLUGIN_ROOT\}|\.)\/([A-Za-z0-9_./-]+)/g)) add(match[1]);
	}
	for (const skill of readdirSync(join(root, "skills"), { withFileTypes: true })) if (skill.isDirectory()) add(`skills/${skill.name}/SKILL.md`);
	for (const relative of declared) {
		if (!existsSync(join(root, relative))) throw new Error(`declared_file_missing: ${pluginPath}/${relative} is declared by the packed plugin but absent from the tarball`);
	}
	return [...declared].sort();
}

const versionParts = (version: string) => version.split(".").map((part) => Number.parseInt(part, 10) || 0);
const versionBelow = (version: string, minimum: string): boolean => {
	const [a, b] = [versionParts(version), versionParts(minimum)];
	for (let index = 0; index < Math.max(a.length, b.length); index++) {
		if ((a[index] ?? 0) !== (b[index] ?? 0)) return (a[index] ?? 0) < (b[index] ?? 0);
	}
	return false;
};

/** A claude binary at or above tests/e2e/hosts.json's minimum; a lower version fails with the version diagnostic. */
async function assertClaudeMinimum(bin: string): Promise<string> {
	const minimum = loadHostPins().claude.minimum;
	if (!bin || !existsSync(bin)) throw new HostError("host_binary_missing", `claude ${minimum} (minimum) is not installed (looked for ${bin || "no binary"})`);
	const child = Bun.spawn([bin, "--version"], { stdout: "pipe", stderr: "pipe", env: baseEnv() });
	const [stdout] = await Promise.all([new Response(child.stdout).text(), child.exited]);
	const version = stdout.trim().split(/\s+/)[0];
	if (versionBelow(version, minimum)) throw new HostError("host_version_mismatch", `claude ${version} is below the minimum supported ${minimum} in tests/e2e/hosts.json`);
	return version;
}

/** The claude binary the minimum-version case runs: the pin itself when pin == minimum, else E2E_CLAUDE_MIN_BIN. */
async function minimumClaude(): Promise<{ bin: string; version: string }> {
	const pins = loadHostPins().claude;
	const bin = pins.minimum === pins.pinned ? claude.bin : process.env.E2E_CLAUDE_MIN_BIN ?? "";
	return { bin, version: await assertClaudeMinimum(bin) };
}

// ---------------------------------------------------------------------------------------------
// Claude Code
// ---------------------------------------------------------------------------------------------

async function claudeListing(bin: string, pluginDir: string) {
	const model = await startJourneyModel("install", "claude");
	const herdr = FakeHerdr.create();
	const work = tempDir("imm-e2e-install-claude-");
	try {
		const homeDir = join(work, "home");
		mkdirSync(homeDir);
		const launch = claudeLaunch({ bin, pluginDir, modelUrl: model.url, prompt: PROMPT, homeDir, apiKey: model.apiKey });
		const { pane } = await herdr.launch({ label: "install-claude", cwd: work, launch });
		const exitCode = await herdr.waitForExit(pane, 120_000);
		const stream = parseClaudeStream(await herdr.output(pane));
		return { stream, exitCode, mock: model.mock };
	} finally {
		herdr.teardown();
		await model.stop();
	}
}

function assertClaudeListing(run: Awaited<ReturnType<typeof claudeListing>>, pluginDir: string): void {
	const init = run.stream.init;
	const plugin = init?.plugins?.find((entry: { name: string }) => entry.name === "immune-brain");
	if (plugin?.path !== pluginDir) throw new Error(`plugin_not_loaded: claude did not load immune-brain from ${pluginDir}`);
	const server = init?.mcp_servers?.find((entry: { name: string }) => entry.name === "plugin:immune-brain:immune-brain");
	if (server?.status !== "connected") throw new Error(`mcp_not_connected: plugin:immune-brain:immune-brain is ${server?.status ?? "absent"}`);
	const missing = [
		...SKILLS.flatMap((name) => [
			init?.skills?.includes(`immune-brain:${name}`) ? "" : `skill immune-brain:${name}`,
			init?.slash_commands?.includes(`immune-brain:${name}`) ? "" : `slash command immune-brain:${name}`,
		]),
		...MCP_TOOLS.map((name) => (init?.tools?.includes(`mcp__plugin_immune-brain_immune-brain__${name}`) ? "" : `MCP tool ${name}`)),
	].filter(Boolean);
	if (missing.length) throw new Error(`listing_incomplete: ${missing.join(", ")}`);
}

async function expectClaudeLoads(bin: string, expectedVersion: string) {
	const run = await claudeListing(bin, install.claudePluginDir);
	expect(run.exitCode).toBe(0);
	expect(run.stream.init?.claude_code_version).toBe(expectedVersion);
	assertClaudeListing(run, install.claudePluginDir);
	// The scripted exchange completed through ANTHROPIC_BASE_URL and consumed exactly its one turn.
	if (run.mock) {
		expect(run.stream.result?.result).toBe("e2e-install-ok");
		expect(run.mock.requests).toHaveLength(1);
		assertNoFailures(run.mock);
	} else {
		expect(run.stream.result?.result).toBeTruthy();
	}
}

// ---------------------------------------------------------------------------------------------
// Pi
// ---------------------------------------------------------------------------------------------

/** Installs the extracted package through `pi install`, then asks a Pi rpc session for its commands and runs one scripted turn to see its tools. */
async function piListing() {
	const pins = loadHostPins();
	// `bun run` prepends every node_modules/.bin (the repository's own dev copy of Pi is not the pinned Host).
	const hostPath = (baseEnv().PATH ?? "").split(delimiter).filter((entry) => !entry.split(sep).slice(-2).every((part, index) => part === ["node_modules", ".bin"][index])).join(delimiter);
	const bin = process.env.E2E_PI_BIN || Bun.which("pi", { PATH: hostPath }) || "";
	if (!bin) throw new HostError("host_binary_missing", `pi ${pins.pi.pinned} is not installed`);
	const work = tempDir("imm-e2e-install-pi-");
	const agentDir = join(work, "agent");
	mkdirSync(agentDir);
	mkdirSync(join(work, "home"));
	mkdirSync(join(work, "cwd"));
	const model = await startJourneyModel("install", "pi");
	const env = { ...baseEnv(), PATH: hostPath, HOME: join(work, "home"), PI_CODING_AGENT_DIR: agentDir, PI_OFFLINE: "1" };
	writeFileSync(join(agentDir, "models.json"), JSON.stringify({ providers: { mock: { baseUrl: model.url, api: "anthropic-messages", apiKey: model.apiKey ?? "sk-ant-e2e-mock", models: [{ id: "mock-model", name: "mock", reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 8000, maxTokens: 1000 }] } } }));
	let child: ReturnType<typeof Bun.spawn> | undefined;
	try {
		const version = Bun.spawn([bin, "--version"], { stdout: "pipe", stderr: "pipe", env });
		const piVersion = (await new Response(version.stdout).text()).trim();
		if (piVersion !== pins.pi.pinned) throw new HostError("host_version_mismatch", `pi ${piVersion} found, tests/e2e/hosts.json pins ${pins.pi.pinned}`);
		const installed = Bun.spawn([bin, "install", install.packageDir], { cwd: join(work, "cwd"), stdout: "pipe", stderr: "pipe", env });
		const installCode = await installed.exited;
		if (installCode !== 0) throw new HostError("host_failed", `pi install exited ${installCode}: ${await new Response(installed.stderr).text()}`);

		child = Bun.spawn([bin, "--mode", "rpc", "--model", "mock/mock-model", "--no-session"], { cwd: join(work, "cwd"), stdin: "pipe", stdout: "pipe", stderr: "pipe", env });
		const send = (message: unknown) => {
			child!.stdin.write(JSON.stringify(message) + "\n");
			child!.stdin.flush();
		};
		const frames: Array<Record<string, any>> = [];
		const waiters: Array<() => void> = [];
		void (async () => {
			let buffer = "";
			for await (const chunk of child!.stdout as unknown as AsyncIterable<Uint8Array>) {
				buffer += new TextDecoder().decode(chunk);
				for (let newline = buffer.indexOf("\n"); newline >= 0; newline = buffer.indexOf("\n")) {
					const line = buffer.slice(0, newline);
					buffer = buffer.slice(newline + 1);
					try { frames.push(JSON.parse(line)); } catch { /* not a protocol frame */ }
					for (const wake of waiters.splice(0)) wake();
				}
			}
		})();
		const until = async (match: (frame: Record<string, any>) => boolean, what: string, timeoutMs = 90_000) => {
			const deadline = Date.now() + timeoutMs;
			for (;;) {
				const found = frames.find(match);
				if (found) return found;
				const left = deadline - Date.now();
				if (left <= 0) throw new HostError("host_timeout", `pi rpc did not produce ${what} within ${timeoutMs} ms`);
				await new Promise<void>((resolve) => { waiters.push(resolve); setTimeout(resolve, Math.min(left, 500)); });
			}
		};
		send({ id: "commands", type: "get_commands" });
		const commands = (await until((frame) => frame.type === "response" && frame.id === "commands", "get_commands")) as { success: boolean; data: { commands: Array<{ name: string; source: string }> } };
		send({ id: "turn", type: "prompt", message: PROMPT });
		await until((frame) => frame.type === "agent_end", "agent_end");
		return { piVersion, commands: commands.data.commands, mock: model.mock, requests: model.requests };
	} finally {
		child?.kill(9);
		await model.stop();
	}
}

// ---------------------------------------------------------------------------------------------
// Antigravity (no Host binary in L1: MCP stdio and the declared hook commands, Spec D3)
// ---------------------------------------------------------------------------------------------

async function antigravityListing(packageDir: string) {
	const root = join(packageDir, ANTIGRAVITY);
	const config = JSON.parse(readFileSync(join(root, "mcp_config.json"), "utf8")).mcpServers["immune-brain"] as { command: string; args: string[] };
	const resolveRoot = (text: string) => text.replaceAll("${PLUGIN_ROOT}", root);
	const server = Bun.spawn([config.command, ...config.args.map(resolveRoot)], { cwd: root, stdin: "pipe", stdout: "pipe", stderr: "pipe", env: { ...baseEnv(), PLUGIN_ROOT: root } });
	const send = (message: unknown) => {
		server.stdin.write(JSON.stringify(message) + "\n");
		server.stdin.flush();
	};
	send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "imm-e2e", version: "0" } } });
	send({ jsonrpc: "2.0", method: "notifications/initialized" });
	send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
	const reader = (server.stdout as unknown as ReadableStream<Uint8Array>).getReader();
	const decoder = new TextDecoder();
	const replies = new Map<number, any>();
	const deadline = Date.now() + 30_000;
	try {
		let buffer = "";
		while (!replies.has(2) && Date.now() < deadline) {
			const { value, done } = await Promise.race([reader.read(), Bun.sleep(1000).then(() => ({ value: undefined, done: false }))]);
			if (done) break;
			buffer += value ? decoder.decode(value) : "";
			for (let newline = buffer.indexOf("\n"); newline >= 0; newline = buffer.indexOf("\n")) {
				const line = buffer.slice(0, newline);
				buffer = buffer.slice(newline + 1);
				try { const frame = JSON.parse(line); if (frame.id) replies.set(frame.id, frame.result); } catch { /* not a frame */ }
			}
		}
	} finally {
		server.kill(9);
	}
	// Hooks resolve: every declared hook command runs from the plugin root and exits 0 on an empty event.
	const hooks = JSON.parse(readFileSync(join(root, "hooks.json"), "utf8"))["immune-brain"] as Record<string, any[]>;
	const commands = new Set<string>();
	for (const entries of Object.values(hooks)) for (const entry of entries) for (const hook of entry.hooks ?? [entry]) commands.add(hook.command as string);
	const hookExits: Record<string, number> = {};
	for (const command of commands) {
		const hook = Bun.spawn(["sh", "-c", command], { cwd: root, stdin: "pipe", stdout: "pipe", stderr: "pipe", env: baseEnv() });
		hook.stdin.write("{}");
		hook.stdin.end();
		hookExits[command] = await hook.exited;
	}
	const skills = readdirSync(join(root, "skills"), { withFileTypes: true }).filter((entry) => entry.isDirectory() && existsSync(join(root, "skills", entry.name, "SKILL.md"))).map((entry) => entry.name);
	return { serverInfo: replies.get(1)?.serverInfo, tools: ((replies.get(2)?.tools ?? []) as Array<{ name: string }>).map((tool) => tool.name), hookExits, skills };
}

// ---------------------------------------------------------------------------------------------
// Journeys
// ---------------------------------------------------------------------------------------------

describe("install (J4)", () => {
	test("Claude Code at the pinned version lists the packed plugin's Skills, slash commands and MCP tools", async () => {
		await expectClaudeLoads(claude.bin, loadHostPins().claude.pinned);
	}, 300_000);

	test("Claude Code at the minimum supported version loads the same packed plugin", async () => {
		const min = await minimumClaude();
		await expectClaudeLoads(min.bin, min.version);
	}, 300_000);

	test("Pi installs the extracted package and lists its Skill commands, extension command and tools", async () => {
		const run = await piListing();
		expect(run.piVersion).toBe(loadHostPins().pi.pinned);
		const names = run.commands.map((command) => command.name);
		for (const skill of SKILLS) expect(names).toContain(`skill:${skill}`);
		for (const command of PI_COMMANDS) expect(names).toContain(command);
		// The scripted turn consumed its cassette and the request offered the extension's tools to the model.
		expect(run.requests.length).toBeGreaterThanOrEqual(1);
		for (const tool of PI_TOOLS) expect(run.requests[0].offeredTools).toContain(tool);
		if (run.mock) {
			expect(run.mock.requests).toHaveLength(1);
			assertNoFailures(run.mock);
		}
	}, 300_000);

	test("Antigravity's packed plugin answers tools/list, exposes its Skills and resolves its hooks", async () => {
		expect(assertDeclaredFiles(install.packageDir, ANTIGRAVITY).length).toBeGreaterThan(SKILLS.length);
		const listing = await antigravityListing(install.packageDir);
		expect(listing.serverInfo?.name).toBe("antigravity");
		for (const tool of MCP_TOOLS) expect(listing.tools).toContain(tool);
		for (const skill of SKILLS) expect(listing.skills).toContain(skill);
		expect(Object.keys(listing.hookExits).length).toBeGreaterThan(0);
		for (const [command, code] of Object.entries(listing.hookExits)) expect({ command, code }).toEqual({ command, code: 0 });
	}, 120_000);

	test("a tarball with one declared plugin file removed fails naming that path", async () => {
		expect(assertDeclaredFiles(install.packageDir, PLUGIN).length).toBeGreaterThan(SKILLS.length);
		const damaged = join(tempDir("imm-e2e-install-damaged-"), "package");
		cpSync(install.packageDir, damaged, { recursive: true });
		rmSync(join(damaged, PLUGIN, "dist/claude/mcp-server.mjs"));
		expect(() => assertDeclaredFiles(damaged, PLUGIN)).toThrow(`declared_file_missing: ${PLUGIN}/dist/claude/mcp-server.mjs`);
		// The Host agrees: its MCP server never connects, so the listing fails rather than passing on the other files.
		const run = await claudeListing(claude.bin, join(damaged, PLUGIN));
		expect(() => assertClaudeListing(run, join(damaged, PLUGIN))).toThrow(/mcp_not_connected/);
	}, 300_000);

	test("a claude version below the minimum fails with the version diagnostic", async () => {
		const minimum = loadHostPins().claude.minimum;
		const parts = versionParts(minimum);
		const below = `${parts[0]}.${parts[1]}.${Math.max(0, parts[2] - 1)}`;
		const dir = tempDir("imm-e2e-install-oldclaude-");
		const shim = join(dir, "claude");
		writeFileSync(shim, `#!/bin/sh\necho "${below} (Claude Code)"\n`);
		chmodSync(shim, 0o755);
		const failure = await assertClaudeMinimum(shim).catch((error) => error as HostError);
		expect(failure).toBeInstanceOf(HostError);
		expect((failure as HostError).code).toBe("host_version_mismatch");
		expect((failure as HostError).message).toContain(`claude ${below} is below the minimum supported ${minimum}`);
	}, 60_000);
});
