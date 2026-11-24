// J1: a scripted single-task drive reaches a terminal TaskRecord with an audit directory and a
// delivered commit (Spec e2e-release-gate D2, J1; S4-AC1). A Claude Code Parent is entered with
// the /immune-brain:drive slash command, starts the single-task Lane through the tarball-installed
// plugin, and the Lane's Executor and Review sessions run as real Host processes in fake-herdr
// panes against the scripted mock model. Run with `bun run e2e single-task`; the pinned claude
// binary (and, for the pi Executor, pi) must be installed: an absent binary fails, never skips.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FakeHerdr, claudeLaunch, makeHostShims, parseClaudeStream, resolveClaude } from "./harness/hosts";
import { type InstallRoot, createInstallRoot } from "./harness/install-root";
import { assertNoFailures } from "./harness/mock-model";
import { startJourneyModel } from "./harness/recorder";

const TASK = "hello-task";
const DRIVE_ENTRY = /^\/immune-brain:drive\s+\S/;

/** A failed journey assertion carries a stable code, so a failure names what was violated. */
export class JourneyAssertion extends Error {
	constructor(readonly code: "entry_not_drive_command" | "executor_plugin_dir_missing" | "executor_plugin_dir_wrong", message: string) {
		super(code + ": " + message);
	}
}

/** The Parent must be entered with the /immune-brain:drive slash command; ordinary input never binds a run. */
export function assertDriveEntry(prompt: string): void {
	if (!DRIVE_ENTRY.test(prompt)) throw new JourneyAssertion("entry_not_drive_command", "the entry was " + JSON.stringify(prompt) + ", not /immune-brain:drive <task>");
}

/** A Claude Executor must be launched with the plugin directory of the install root. */
export function assertExecutorPluginDir(args: string[], pluginDir: string): void {
	const at = args.indexOf("--plugin-dir");
	if (at < 0) throw new JourneyAssertion("executor_plugin_dir_missing", "the Executor launch has no --plugin-dir: " + args.join(" "));
	// The runtime launches from the Lane's resolved path; macOS temp roots resolve through /private.
	const canonical = (path: string): string => { try { return realpathSync(path); } catch { return path; } };
	if (canonical(args[at + 1]) !== canonical(pluginDir)) throw new JourneyAssertion("executor_plugin_dir_wrong", "--plugin-dir is " + args[at + 1] + ", the install root has " + pluginDir);
}

interface LaunchRecord { host: string; pane: string | null; cwd: string; args: string[]; event: string; prompt?: string }
const readLaunches = (path: string): LaunchRecord[] => readFileSync(path, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));

async function git(cwd: string, ...args: string[]): Promise<string> {
	const child = Bun.spawn(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe", env: { ...process.env, GIT_AUTHOR_NAME: "e2e", GIT_AUTHOR_EMAIL: "e2e@example.com", GIT_COMMITTER_NAME: "e2e", GIT_COMMITTER_EMAIL: "e2e@example.com" } });
	const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
	if (code !== 0) throw new Error("git " + args.join(" ") + " exited " + code + ": " + stderr.trim());
	return stdout;
}

const intent = {
	contract: "assurance_kernel/task_intent/v1",
	task_id: TASK,
	owner: "user",
	goal: "Create hello.txt containing the word hello.",
	acceptance: [{
		id: "AC1",
		assertion: "hello.txt exists and contains hello.",
		verification: JSON.stringify({ contract: "assurance_kernel/verification_descriptor/v2", command: { executable: "grep", argv: ["-q", "hello", "hello.txt"], cwd: ".", timeout_ms: 20000, max_output_bytes: 65536 }, environment: { prepare: null, writable_paths: [] } }),
	}],
	scope_hint: ["hello.txt"],
	risk: "material",
	revision: 1,
};

/** A one-commit git repository holding a validated TaskIntent and the project config for the Lane's Executor Host. */
async function createFixtureProject(dir: string, executor: "claude" | "pi"): Promise<string> {
	const project = join(dir, "project");
	mkdirSync(join(project, "docs/plans"), { recursive: true });
	mkdirSync(join(project, ".imm"), { recursive: true });
	await git(project, "init", "-q", "-b", "main");
	writeFileSync(join(project, "README.md"), "# fixture\n");
	const executorConfig = executor === "pi" ? { host: "pi", model: "mock/mock-model", effort: "low" } : { host: "claude-code", model: "claude-sonnet-5-5", effort: "low" };
	writeFileSync(join(project, ".imm/config.json"), JSON.stringify({ contract: "immune_brain/project_config/v2", agents: { executor: executorConfig, reviewer: { host: "claude-code", model: "claude-sonnet-5-5", effort: "low" } } }, null, 2));
	writeFileSync(join(project, "docs/plans/" + TASK + ".intent.json"), JSON.stringify(intent, null, 2));
	await git(project, "add", "README.md", ".imm", "docs");
	await git(project, "commit", "-q", "-m", "init");
	return project;
}

let install: InstallRoot;
let claude: { bin: string; version: string };

beforeAll(async () => {
	claude = await resolveClaude();
	install = await createInstallRoot();
}, 300_000);
afterAll(() => install?.cleanup());

async function runJourney(executor: "claude" | "pi", entry = "/immune-brain:drive " + TASK) {
	const work = mkdtempSync(join(tmpdir(), "imm-e2e-work-"));
	const home = join(work, "home");
	mkdirSync(join(home, ".claude"), { recursive: true });
	// The harness stands in for the human at the native gates: Elicitation is accepted, tools are pre-allowed.
	writeFileSync(join(home, ".claude/settings.json"), JSON.stringify({
		permissions: { allow: ["mcp__plugin_immune-brain_immune-brain__*", "Bash", "Read", "Edit", "Write", "Glob", "Grep"] },
		hooks: { Elicitation: [{ hooks: [{ type: "command", command: "printf '%s' '{\"hookSpecificOutput\":{\"hookEventName\":\"Elicitation\",\"action\":\"accept\",\"content\":{}}}'" }] }] },
	}));
	const project = await createFixtureProject(work, executor);
	const model = await startJourneyModel("single-task", executor);
	const launchLog = join(work, "launches.jsonl");
	writeFileSync(launchLog, "");
	let piEnv: Record<string, string> = {};
	if (executor === "pi") {
		const agentDir = join(work, "pi-agent");
		mkdirSync(agentDir);
		writeFileSync(join(agentDir, "models.json"), JSON.stringify({ providers: { mock: { baseUrl: model.url, api: "anthropic-messages", apiKey: model.apiKey ?? "sk-e2e-mock", models: [{ id: "mock-model", name: "mock", reasoning: true, input: ["text"], contextWindow: 200000, maxTokens: 8000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }] } } }));
		writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ packages: [install.packageDir] }));
		const pi = Bun.which("pi", { PATH: process.env.PATH });
		if (!pi) throw new Error("host_binary_missing: pi is not installed");
		piEnv = { E2E_REAL_PI: pi, PI_CODING_AGENT_DIR: agentDir, PI_OFFLINE: "1" };
	}
	const herdr = FakeHerdr.create("w-e2e", {
		HOME: home, CLAUDE_CONFIG_DIR: join(home, ".claude"), ANTHROPIC_BASE_URL: model.url, ANTHROPIC_API_KEY: model.apiKey ?? "sk-ant-e2e-mock",
		DISABLE_AUTOUPDATER: "1", DISABLE_TELEMETRY: "1", CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
		E2E_REAL_CLAUDE: claude.bin, E2E_LAUNCH_LOG: launchLog, ...piEnv,
	}, makeHostShims(join(work, "shims")));
	try {
		const parent = claudeLaunch({ bin: claude.bin, pluginDir: install.claudePluginDir, modelUrl: model.url, prompt: entry, homeDir: home, apiKey: model.apiKey });
		const { pane } = await herdr.launch({ label: "parent", cwd: project, launch: { command: parent.command, env: { ...parent.env, ...herdr.paneEnv() } } });
		const exitCode = await herdr.waitForExit(pane, 480_000);
		const stream = parseClaudeStream(await herdr.output(pane));
		return { work, project, model, exitCode, stream, launches: readLaunches(launchLog), parentCommand: parent.command, events: herdr.events() };
	} finally {
		herdr.teardown();
		await model.stop();
	}
}

type Journey = Awaited<ReturnType<typeof runJourney>>;

/** What a settled single task leaves in the project: the delivered commit, the audit directory, the terminal TaskRecord. */
async function assertDelivered(run: Journey): Promise<void> {
	const branch = "imm/" + TASK;
	expect(await git(run.project, "show", branch + ":hello.txt")).toBe("hello\n");
	expect((await git(run.project, "log", "-1", "--format=%s", branch)).trim()).toStartWith("imm(" + TASK + "):");
	const audit = (await git(run.project, "ls-tree", "-r", "--name-only", branch, ".imm/audit/" + TASK)).trim().split("\n");
	expect(audit).toHaveLength(2);
	const record = JSON.parse(await git(run.project, "show", branch + ":" + audit.find((path) => path.endsWith("task-record.json"))));
	expect(record).toMatchObject({ contract: "assurance_kernel/task_record/v4", task_id: TASK, lifecycle: "done", artifact_state: "frozen" });
	expect(record.attestations.map((entry: { kind: string }) => entry.kind)).toEqual(expect.arrayContaining(["qa", "review"]));
	const proof = JSON.parse(await git(run.project, "show", branch + ":" + audit.find((path) => path.endsWith("terminal-proof.json"))));
	expect(proof).toMatchObject({ task_id: TASK, lifecycle_status: "terminal", terminal_lifecycle: "done" });
}

describe("single-task J1", () => {
	test("claude Executor: enrollment through QA and Review to a terminal TaskRecord and a delivered commit", async () => {
		const run = await runJourney("claude");
		try {
			expect(run.exitCode).toBe(0);
			if (run.model.mock) {
				assertNoFailures(run.model.mock);
				expect([...new Set(run.model.mock.requests.map((request) => request.conv))].sort()).toEqual(["exec", "main", "review"]);
			}
			// The Parent was entered with the drive slash command.
			assertDriveEntry(run.parentCommand[run.parentCommand.indexOf("-p") + 1]);
			// The Executor Host was launched with the install root's plugin directory, after its entry prompt arrived.
			const executor = run.launches.find((launch) => launch.event === "launch" && launch.host === "claude" && launch.args.includes("--model"));
			expect(executor).toBeDefined();
			assertExecutorPluginDir(executor!.args, install.claudePluginDir);
			expect(run.launches.find((launch) => launch.event === "entry" && launch.pane === executor!.pane)?.prompt).toBeTruthy();
			await assertDelivered(run);
		} finally {
			rmSync(run.work, { recursive: true, force: true });
		}
	}, 600_000);

	test("pi Executor: the same journey reaches a terminal TaskRecord and a delivered commit", async () => {
		const run = await runJourney("pi");
		try {
			expect(run.exitCode).toBe(0);
			if (run.model.mock) {
				assertNoFailures(run.model.mock);
				expect([...new Set(run.model.mock.requests.map((request) => request.conv))].sort()).toEqual(["exec", "main", "review"]);
				expect(run.model.mock.requests.find((request) => request.conv === "exec")?.offeredTools).toContain("imm_kernel_canary");
			} else {
				expect(run.model.requests.some((request) => request.offeredTools.includes("imm_kernel_canary"))).toBe(true);
			}
			assertDriveEntry(run.parentCommand[run.parentCommand.indexOf("-p") + 1]);
			// The Executor ran as pi on the mock provider, was handed its entry, and was offered the Kernel tools the package registers.
			const executor = run.launches.find((launch) => launch.event === "launch" && launch.host === "pi");
			expect(executor?.args).toEqual(["--model", "mock/mock-model", "--thinking", "low"]);
			expect(run.launches.find((launch) => launch.event === "entry" && launch.pane === executor!.pane)?.prompt).toBe("drive " + TASK);
			await assertDelivered(run);
		} finally {
			rmSync(run.work, { recursive: true, force: true });
		}
	}, 600_000);

	test("an Executor launch lacking --plugin-dir fails with executor_plugin_dir_missing", () => {
		const launched = ["--model", "claude-sonnet-5-5", "--effort", "low", "--plugin-dir", "/install/plugins/immune-brain"];
		expect(() => assertExecutorPluginDir(launched, "/install/plugins/immune-brain")).not.toThrow();
		expect(() => assertExecutorPluginDir(launched.slice(0, 4), "/install/plugins/immune-brain")).toThrow(/^executor_plugin_dir_missing:/);
		expect(() => assertExecutorPluginDir([...launched.slice(0, 4), "--plugin-dir", "/elsewhere"], "/install/plugins/immune-brain")).toThrow(/^executor_plugin_dir_wrong:/);
	});

	test("an entry that is not the /immune-brain:drive slash command fails with entry_not_drive_command", () => {
		expect(() => assertDriveEntry("/immune-brain:drive " + TASK)).not.toThrow();
		for (const entry of ["drive " + TASK, "/immune-brain:fix-pr 12", "/immune-brain:drive", "please drive " + TASK]) {
			expect(() => assertDriveEntry(entry)).toThrow(/^entry_not_drive_command:/);
		}
	});
});
