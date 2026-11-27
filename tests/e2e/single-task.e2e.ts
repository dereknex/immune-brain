// J1: a scripted single-task drive reaches a terminal TaskRecord with an audit directory and a
// delivered commit (Spec e2e-release-gate D2, J1; S4-AC1). A Claude Code Parent is entered with
// the /immune-brain:drive slash command, enrolls the task in place through the tarball-installed
// plugin's `enroll` (Spec retire-unattended-batch D2), implements it in the same session, and its
// Review session runs as a real Host process in a fake-herdr pane against the scripted mock model.
// Run with `bun run e2e single-task`; the pinned claude binary must be installed: an absent binary
// fails, never skips.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
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
	constructor(readonly code: "entry_not_drive_command", message: string) {
		super(code + ": " + message);
	}
}

/** The Parent must be entered with the /immune-brain:drive slash command; ordinary input never binds a run. */
export function assertDriveEntry(prompt: string): void {
	if (!DRIVE_ENTRY.test(prompt)) throw new JourneyAssertion("entry_not_drive_command", "the entry was " + JSON.stringify(prompt) + ", not /immune-brain:drive <task>");
}

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

/** A one-commit git repository holding a validated TaskIntent and a project config that commits settled delivery. */
async function createFixtureProject(dir: string): Promise<string> {
	const project = join(dir, "project");
	mkdirSync(join(project, "docs/plans"), { recursive: true });
	mkdirSync(join(project, ".imm"), { recursive: true });
	await git(project, "init", "-q", "-b", "main");
	writeFileSync(join(project, "README.md"), "# fixture\n");
	writeFileSync(join(project, ".imm/config.json"), JSON.stringify({ contract: "immune_brain/project_config/v2", git_integration: "auto", agents: { reviewer: { host: "claude-code", model: "claude-sonnet-5-5", effort: "low" } } }, null, 2));
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

async function runJourney(entry = "/immune-brain:drive " + TASK) {
	const work = mkdtempSync(join(tmpdir(), "imm-e2e-work-"));
	const home = join(work, "home");
	mkdirSync(join(home, ".claude"), { recursive: true });
	// The harness stands in for the human at the native gates: Elicitation is accepted, tools are pre-allowed.
	writeFileSync(join(home, ".claude/settings.json"), JSON.stringify({
		permissions: { allow: ["mcp__plugin_immune-brain_immune-brain__*", "Bash", "Read", "Edit", "Write", "Glob", "Grep"] },
		hooks: { Elicitation: [{ hooks: [{ type: "command", command: "printf '%s' '{\"hookSpecificOutput\":{\"hookEventName\":\"Elicitation\",\"action\":\"accept\",\"content\":{}}}'" }] }] },
	}));
	const project = await createFixtureProject(work);
	const model = await startJourneyModel("single-task", "claude");
	const herdr = FakeHerdr.create("w-e2e", {
		HOME: home, CLAUDE_CONFIG_DIR: join(home, ".claude"), ANTHROPIC_BASE_URL: model.url, ANTHROPIC_API_KEY: model.apiKey ?? "sk-ant-e2e-mock",
		DISABLE_AUTOUPDATER: "1", DISABLE_TELEMETRY: "1", CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
		E2E_REAL_CLAUDE: claude.bin,
	}, makeHostShims(join(work, "shims")));
	try {
		const parent = claudeLaunch({ bin: claude.bin, pluginDir: install.claudePluginDir, modelUrl: model.url, prompt: entry, homeDir: home, apiKey: model.apiKey });
		const { pane } = await herdr.launch({ label: "parent", cwd: project, launch: { command: parent.command, env: { ...parent.env, ...herdr.paneEnv() } } });
		const exitCode = await herdr.waitForExit(pane, 480_000);
		const stream = parseClaudeStream(await herdr.output(pane));
		return { work, project, model, exitCode, stream, parentCommand: parent.command, events: herdr.events() };
	} finally {
		herdr.teardown();
		await model.stop();
	}
}

type Journey = Awaited<ReturnType<typeof runJourney>>;

/** What a settled single task leaves in the project: the delivered commit, the audit directory, the terminal TaskRecord. */
async function assertDelivered(run: Journey): Promise<void> {
	// In place: the settled delivery is committed on the checkout's own branch; no Lane or batch branch exists.
	const branch = "main";
	expect((await git(run.project, "branch", "--format=%(refname:short)")).trim().split("\n")).toEqual(["main"]);
	expect((await git(run.project, "worktree", "list", "--porcelain")).split("\n").filter((line) => line.startsWith("worktree "))).toHaveLength(1);
	expect(await git(run.project, "show", branch + ":hello.txt")).toBe("hello\n");
	expect((await git(run.project, "log", "-1", "--format=%s", branch)).trim()).toStartWith("imm(" + TASK + "):");
	// Auto integration commits exactly the settled scoped delivery (Spec D8, SCN-4); the audit proof is
	// written beside it in the worktree for the user to commit with their own history.
	expect((await git(run.project, "show", "--name-only", "--format=", branch)).trim().split("\n")).toEqual(["hello.txt"]);
	const auditRoot = join(run.project, ".imm/audit", TASK);
	const audit = readdirSync(auditRoot, { recursive: true, withFileTypes: true }).filter((entry) => entry.isFile()).map((entry) => join(entry.parentPath, entry.name));
	expect(audit).toHaveLength(2);
	const record = JSON.parse(readFileSync(audit.find((path) => path.endsWith("task-record.json"))!, "utf8"));
	expect(record).toMatchObject({ contract: "assurance_kernel/task_record/v4", task_id: TASK, lifecycle: "done", artifact_state: "frozen" });
	expect(record.attestations.map((entry: { kind: string }) => entry.kind)).toEqual(expect.arrayContaining(["qa", "review"]));
	const proof = JSON.parse(readFileSync(audit.find((path) => path.endsWith("terminal-proof.json"))!, "utf8"));
	expect(proof).toMatchObject({ task_id: TASK, lifecycle_status: "terminal", terminal_lifecycle: "done" });
}

describe("single-task J1", () => {
	test("claude Parent: in-place enrollment through QA and Review to a terminal TaskRecord and a delivered commit", async () => {
		const run = await runJourney();
		try {
			expect(run.exitCode).toBe(0);
			if (run.model.mock) {
				assertNoFailures(run.model.mock);
				// The Parent implements in place; only its Review runs as a second Host session.
				expect([...new Set(run.model.mock.requests.map((request) => request.conv))].sort()).toEqual(["main", "review"]);
			}
			// The Parent was entered with the drive slash command.
			assertDriveEntry(run.parentCommand[run.parentCommand.indexOf("-p") + 1]);
			await assertDelivered(run);
		} finally {
			rmSync(run.work, { recursive: true, force: true });
		}
	}, 600_000);

	test("an entry that is not the /immune-brain:drive slash command fails with entry_not_drive_command", () => {
		expect(() => assertDriveEntry("/immune-brain:drive " + TASK)).not.toThrow();
		for (const entry of ["drive " + TASK, "/immune-brain:fix-pr 12", "/immune-brain:drive", "please drive " + TASK]) {
			expect(() => assertDriveEntry(entry)).toThrow(/^entry_not_drive_command:/);
		}
	});
});
