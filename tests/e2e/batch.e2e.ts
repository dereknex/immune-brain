// J2 batch: a two-child Initiative runs as parallel Lanes, integrates and passes final verification
// (delivered), or a forced final-verification failure retains the integration branch and delivers
// nothing (Spec e2e-release-gate D2, J2, S6-AC1). Run with `bun run e2e batch`; the pinned claude binary
// must be installed (absent fails). Black box: process boundaries only, no runtime imports.
//
// The Parent and each Lane Executor are real pinned claude sessions, each against its own scripted
// mock model replaying one session of tests/e2e/cassettes/batch/claude.jsonl. The test-local herdr
// shim below covers the two things the S2 fake-herdr does not model: it resolves the Host binary
// from `agent start --kind` (real Herdr does) and it holds an interactive Lane Executor until
// `agent prompt` delivers its entry prompt, then runs it as `claude -p <prompt>`.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { FakeHerdr, type HerdrEvent, claudeLaunch, parseClaudeStream, resolveClaude } from "./harness/hosts";
import { type InstallRoot, createInstallRoot } from "./harness/install-root";
import { type CassetteTurn, cassettePath, parseCassette, startMockModel } from "./harness/mock-model";

const FAKE_HERDR = join(import.meta.dir, "../fixtures/fake-herdr/herdr");
const SLUG = "e2e-batch";
const CHILDREN = [
	{ task: "e2e-batch-a", slice: "A", file: "out/a.txt", lane: "a" },
	{ task: "e2e-batch-b", slice: "B", file: "out/b.txt", lane: "b" },
];

let install: InstallRoot;
let claude: { bin: string; version: string };

beforeAll(async () => {
	claude = await resolveClaude();
	install = await createInstallRoot();
}, 300_000);
afterAll(() => install?.cleanup());

/** The cassette's sessions: each line carries a `session` and its per-session turn index. */
function sessions(): Map<string, CassetteTurn[]> {
	const grouped = new Map<string, string[]>();
	for (const line of readFileSync(cassettePath("batch", "claude"), "utf8").split("\n").filter((entry) => entry.trim())) {
		const session = (JSON.parse(line) as { session: string }).session;
		grouped.set(session, [...(grouped.get(session) ?? []), line]);
	}
	return new Map([...grouped].map(([session, entries]) => [session, parseCassette(entries.join("\n"), "batch/" + session)]));
}

const descriptor = (argv: string[]) => JSON.stringify({ contract: "assurance_kernel/verification_descriptor/v2", command: { executable: argv[0], argv: argv.slice(1), cwd: ".", timeout_ms: 60_000, max_output_bytes: 65_536 }, environment: { prepare: null, writable_paths: [] } }, null, 2) + "\n";

/** A throwaway git project with a two-child local Initiative; each child writes one file. */
function writeProject(dir: string): void {
	const put = (path: string, content: string) => {
		mkdirSync(join(dir, path, ".."), { recursive: true });
		writeFileSync(join(dir, path), content);
	};
	put("README.md", "e2e batch fixture\n");
	put(".gitignore", ".imm/config.json\n.imm/state/\n");
	put("docs/initiatives/" + SLUG + ".md", "# E2E batch\n\n" + CHILDREN.map((child) => "## " + child.slice + ": write " + child.file + "\n\nTasks:\n- " + child.task + "\n").join("\n"));
	for (const child of CHILDREN) {
		put("docs/plans/" + child.task + ".intent.json", JSON.stringify({
			contract: "assurance_kernel/task_intent/v1",
			task_id: child.task,
			owner: "user",
			goal: "Write " + child.file + ".",
			acceptance: [{ id: child.slice + "-AC1", assertion: child.file + " exists.", verification: descriptor(["test", "-f", child.file]) }],
			scope_hint: ["docs/plans/" + child.task + ".intent.json", child.file],
			risk: "routine",
			revision: 1,
		}, null, 2) + "\n");
	}
	put(".imm/config.json", JSON.stringify({ contract: "immune_brain/project_config/v2", agents: { executor: "claude-code", reviewer: "claude-code" }, batch: { max_parallel: 2 }, initiative_carrier: "local", git_integration: "auto" }, null, 2) + "\n");
}

const SHIM = String.raw`#!/usr/bin/env bun
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
const argv = process.argv.slice(2);
const state = process.env.FAKE_HERDR_STATE;
if (argv[0] === "agent" && argv[1] === "start") {
	const dash = argv.indexOf("--");
	if (dash >= 0 && String(argv[dash + 1] ?? "").startsWith("-")) argv.splice(dash + 1, 0, process.env.E2E_CLAUDE_BIN ?? "claude");
	const command = argv.slice(dash + 1);
	if (dash >= 0 && !command.includes("-p")) {
		const pane = argv[argv.indexOf("--pane") + 1];
		const lane = /^e2e-batch-([ab])-/.exec(argv[2] ?? "")?.[1];
		const url = process.env["E2E_MODEL_URL_" + String(lane).toUpperCase()];
		if (!url) { process.stderr.write("shim: no scripted model for Lane " + argv[2] + "\n"); process.exit(9); }
		argv.splice(dash + 1, command.length, "sh", "-c", 'f=$1; u=$2; shift 2; while [ ! -s "$f" ]; do sleep 0.2; done; exec env ANTHROPIC_BASE_URL="$u" "$@" -p "$(cat "$f")" --output-format stream-json --verbose', "sh", state + "." + pane + ".prompt", url, ...command);
	}
}
if (argv[0] === "agent" && argv[1] === "prompt") writeFileSync(state + "." + argv[2] + ".prompt", argv[3] ?? "");
const result = spawnSync(process.env.E2E_REAL_HERDR, argv, { stdio: "inherit", env: process.env });
process.exit(result.status ?? 1);
`;

const sh = async (cwd: string, ...argv: string[]): Promise<string> => {
	const child = Bun.spawn(argv, { cwd, stdout: "pipe", stderr: "pipe", env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
	const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
	if (code !== 0) throw new Error(argv.join(" ") + " exited " + code + ": " + (stderr.trim() || stdout.trim()));
	return stdout.trim();
};
const git = (cwd: string, ...args: string[]) => sh(cwd, "git", ...args);

interface Journey {
	exitCode: number | null;
	toolResults: string[];
	herdrEvents: HerdrEvent[];
	requests: Record<string, number>;
	turns: Record<string, number>;
	failures: string[];
	baseHead: string;
	mainHead: string;
	mainFiles: string[];
	integrationBranchHead: string | null;
	integrationFiles: string[];
	branches: string[];
}

/** Runs the Parent drive entry for the fixture Initiative with the given Parent session script. */
async function runJourney(parentSession: string): Promise<Journey> {
	const script = sessions();
	const names = [parentSession, "lane-a", "lane-b"];
	const models = Object.fromEntries(await Promise.all(names.map(async (name) => [name, await startMockModel({ turns: script.get(name) ?? (() => { throw new Error("cassette_session_missing: " + name); })() })])));
	const herdr = FakeHerdr.create();
	const work = mkdtempSync(join(tmpdir(), "imm-e2e-batch-"));
	try {
		const project = join(work, "project");
		mkdirSync(project);
		writeProject(project);
		await git(project, "init", "-q", "-b", "main");
		await git(project, "config", "user.email", "e2e@example.invalid");
		await git(project, "config", "user.name", "e2e");
		await git(project, "add", "-A");
		await git(project, "commit", "-q", "-m", "base");
		const baseHead = await git(project, "rev-parse", "HEAD");

		const homeDir = join(work, "home");
		mkdirSync(join(homeDir, ".claude"), { recursive: true });
		// Unattended -p sessions cannot answer prompts: bypass permissions, and accept any MCP elicitation.
		writeFileSync(join(homeDir, ".claude", "settings.json"), JSON.stringify({
			permissions: { defaultMode: "bypassPermissions" },
			skipDangerousModePermissionPrompt: true,
			hooks: { Elicitation: [{ hooks: [{ type: "command", command: "echo '{\"hookSpecificOutput\":{\"hookEventName\":\"Elicitation\",\"action\":\"accept\",\"content\":{}}}'" }] }] },
		}));
		const shimDir = join(work, "shim");
		mkdirSync(shimDir);
		writeFileSync(join(shimDir, "herdr"), SHIM, { mode: 0o755 });

		const launch = claudeLaunch({ bin: claude.bin, pluginDir: install.claudePluginDir, modelUrl: models[parentSession].url, prompt: "/immune-brain:drive " + SLUG, homeDir });
		// The Parent's pane env reaches every Lane: the runtime shells out to herdr from it.
		Object.assign(launch.env, {
			FAKE_HERDR_STATE: herdr.stateFile,
			PATH: [shimDir, ...(process.env.PATH ?? "").split(delimiter)].join(delimiter),
			E2E_REAL_HERDR: FAKE_HERDR,
			E2E_CLAUDE_BIN: claude.bin,
			E2E_MODEL_URL_A: models["lane-a"].url,
			E2E_MODEL_URL_B: models["lane-b"].url,
		});
		const { pane } = await herdr.launch({ label: "parent", cwd: project, launch });
		const exitCode = await herdr.waitForExit(pane, 420_000);
		const stream = parseClaudeStream(await herdr.output(pane));
		const toolResults = stream.events
			.filter((event) => event.type === "user" && Array.isArray(event.message?.content))
			.flatMap((event) => event.message.content.filter((block: any) => block.type === "tool_result"))
			.map((block: any) => typeof block.content === "string" ? block.content : (block.content ?? []).map((part: any) => part.text ?? "").join(""));

		const lines = async (...args: string[]) => (await git(project, ...args)).split("\n").filter(Boolean);
		const branches = (await lines("for-each-ref", "--format=%(refname:short)", "refs/heads")).sort();
		const integration = branches.find((name) => name === "imm/" + SLUG) ?? null;
		return {
			exitCode,
			toolResults,
			herdrEvents: herdr.events(),
			requests: Object.fromEntries(names.map((name) => [name, models[name].requests.length])),
			turns: Object.fromEntries(names.map((name) => [name, script.get(name)!.length])),
			failures: names.flatMap((name) => models[name].failures.map((failure: any) => name + ": " + failure.code + ": " + failure.message)),
			baseHead,
			mainHead: await git(project, "rev-parse", "main"),
			mainFiles: await lines("ls-tree", "-r", "--name-only", "main", "out"),
			integrationBranchHead: integration ? await git(project, "rev-parse", integration) : null,
			integrationFiles: integration ? await lines("ls-tree", "-r", "--name-only", integration, "out") : [],
			branches,
		};
	} finally {
		herdr.teardown();
		await Promise.all(names.map((name) => models[name].stop()));
		rmSync(work, { recursive: true, force: true });
	}
}

/** Both Lane Hosts started before either exited: the two Lanes overlapped. */
function lanesOverlapped(events: HerdrEvent[]): boolean {
	const laneStarts = events.filter((event) => event.event === "start" && /^e2e-batch-[ab]-/.test(String(event.name)));
	const laneExits = events.filter((event) => event.event === "exit" && laneStarts.some((start) => start.pane === event.pane));
	return laneStarts.length === 2 && laneExits.length >= 1 && laneStarts.every((start) => start.at < laneExits[0].at);
}

describe("batch", () => {
	test("a two-child Initiative runs parallel Lanes, integrates and delivers after final verification", async () => {
		const run = await runJourney("parent");
		expect(run.failures).toEqual([]);
		expect(run.exitCode).toBe(0);
		// Every scripted session consumed exactly its cassette: Parent, Lane a and Lane b.
		expect(run.requests).toEqual(run.turns);
		expect(lanesOverlapped(run.herdrEvents)).toBe(true);
		// Delivered: main advanced past base and carries both children's files; the report says integrated.
		expect(run.mainHead).not.toBe(run.baseHead);
		expect(run.mainFiles).toEqual(["out/a.txt", "out/b.txt"]);
		const report = run.toolResults.filter((text) => text.includes("assurance_kernel/batch_run_report/v1")).at(-1) ?? "";
		expect(report).toContain('"state":"integrated"');
		expect(report).toContain('"batch_state":"completed"');
		expect(report).toContain('"final_verification":{"passed":true');
		expect(report).not.toContain("final verification did not pass");
	}, 600_000);

	test("a forced final-verification failure retains the integration branch and delivers nothing", async () => {
		const run = await runJourney("parent-fv-fail");
		expect(run.failures).toEqual([]);
		expect(run.exitCode).toBe(0);
		expect(run.requests).toEqual(run.turns);
		expect(lanesOverlapped(run.herdrEvents)).toBe(true);
		// The report names the failed command and the Parent stops without delivering.
		const report = run.toolResults.filter((text) => text.includes("assurance_kernel/batch_run_report/v1")).at(-1) ?? "";
		expect(report).toContain("final verification did not pass: test -f out/missing.txt");
		expect(report).toContain('"final_verification":{"passed":false');
		// Nothing delivered: main is untouched and carries neither child's file.
		expect(run.mainHead).toBe(run.baseHead);
		expect(run.mainFiles).toEqual([]);
		// Retained: the integration branch still holds both integrated children.
		expect(run.integrationBranchHead).not.toBeNull();
		expect(run.integrationFiles).toEqual(["out/a.txt", "out/b.txt"]);
	}, 600_000);
});
