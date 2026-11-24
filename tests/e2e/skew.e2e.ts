// J5 skew: a stale plugin cache and a too-old runtime each produce their named diagnostic and
// its single recovery action when the user enters drive, without parking a Lane
// (Spec e2e-release-gate D2, S7-AC1). Run with `bun run e2e skew`; the pinned claude binary must
// be installed (absent fails). Black box: the Host, its MCP server and git only.
//
// The scripted model (cassettes/skew/claude.jsonl) plays what drive does first: read `status`,
// then call `start_unattended_batch` for the task. Each scenario differs only in the workspace.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FakeHerdr, claudeLaunch, parseClaudeStream, resolveClaude } from "./harness/hosts";
import { type InstallRoot, createInstallRoot } from "./harness/install-root";
import { startJourneyModel } from "./harness/recorder";

const TASK_ID = "skew-task";
const MCP_TOOLS = "mcp__plugin_immune-brain_immune-brain";
const NEWER_CONTRACT = "assurance_kernel/batch_run_state/v99";

let install: InstallRoot;
beforeAll(async () => {
	await resolveClaude();
	install = await createInstallRoot();
}, 300_000);
afterAll(() => install?.cleanup());

function git(cwd: string, ...args: string[]): string {
	const env = { PATH: process.env.PATH ?? "", GIT_AUTHOR_NAME: "e2e", GIT_AUTHOR_EMAIL: "e2e@example.invalid", GIT_COMMITTER_NAME: "e2e", GIT_COMMITTER_EMAIL: "e2e@example.invalid" };
	const done = Bun.spawnSync(["git", ...args], { cwd, env });
	if (done.exitCode !== 0) throw new Error(`git ${args.join(" ")} failed: ${done.stderr.toString().trim()}`);
	return done.stdout.toString();
}

/** The workspace plugin source one build newer than the packed plugin the Host loads (a stale cache). */
function writeNewerPluginSource(ws: string): void {
	const source = join(ws, "plugins/immune-brain");
	mkdirSync(join(source, ".claude-plugin"), { recursive: true });
	mkdirSync(join(source, "dist/claude"), { recursive: true });
	writeFileSync(join(source, ".claude-plugin/plugin.json"), readFileSync(join(install.claudePluginDir, ".claude-plugin/plugin.json")));
	writeFileSync(join(source, "dist/claude/mcp-server.mjs"), `${readFileSync(join(install.claudePluginDir, "dist/claude/mcp-server.mjs"), "utf8")}\n// a runtime change the loaded cache does not have\n`);
}

/** A batch record written by a runtime newer than the packed one understands. */
function writeNewerBatchRecord(ws: string): string {
	const path = join(ws, ".imm/state/batches/batch-skew.json");
	mkdirSync(join(ws, ".imm/state/batches"), { recursive: true });
	writeFileSync(path, JSON.stringify({ contract: NEWER_CONTRACT, initiative_slug: TASK_ID, batch_id: "batch-skew" }));
	return path;
}

interface DriveRun {
	ws: string;
	exitCode: number | null;
	result?: string;
	/** Parsed JSON body of each MCP tool result, keyed by tool name. */
	tools: Record<string, any>;
	/** The workspace's Lane footprint after the run. */
	lanes: { worktrees: number; imm_worktree_dir: boolean; batch_records: string[]; herdr_events: string[] };
}

/** Enters drive (the slash entry) in `ws` against the pinned claude and the skew cassette. */
async function drive(setup: (ws: string) => void): Promise<DriveRun & { cleanup(): void }> {
	const claude = await resolveClaude();
	const model = await startJourneyModel("skew", "claude");
	const herdr = FakeHerdr.create();
	const work = mkdtempSync(join(tmpdir(), "imm-e2e-work-"));
	const cleanup = () => rmSync(work, { recursive: true, force: true });
	try {
		const ws = join(work, "ws");
		mkdirSync(ws);
		git(ws, "init", "-q", "-b", "main");
		setup(ws);
		git(ws, "add", "-A");
		git(ws, "commit", "-q", "--allow-empty", "-m", "base");
		const homeDir = join(work, "home");
		mkdirSync(homeDir);
		const launch = claudeLaunch({ bin: claude.bin, pluginDir: install.claudePluginDir, modelUrl: model.url, prompt: `/immune-brain:drive ${TASK_ID}`, homeDir, apiKey: model.apiKey });
		launch.command.push("--allowedTools", MCP_TOOLS);
		const { pane } = await herdr.launch({ label: "skew-claude", cwd: ws, launch });
		const exitCode = await herdr.waitForExit(pane, 180_000);
		const stream = parseClaudeStream(await herdr.output(pane));

		if (model.mock) {
			// Every cassette turn was served. Before the plugin's MCP server connects, claude's first
			// request offers no plugin tools and the cassette refuses it, so the Host retries; that
			// refusal is the only failure a run may record.
			const unexpected = model.mock.failures.filter((failure) => !(failure.code === "cassette_mismatch" && /^turn 0 .* does not offer \[/.test(failure.message)));
			expect(unexpected).toEqual([]);
			expect(model.mock.requests.filter((request) => request.offeredTools.includes(`${MCP_TOOLS}__status`)).map((request) => request.turn)).toEqual([0, 1, 2]);
		}

		const names = new Map<string, string>();
		const tools: Record<string, any> = {};
		for (const event of stream.events) {
			for (const block of Array.isArray(event.message?.content) ? event.message.content : []) {
				if (block.type === "tool_use") names.set(block.id, String(block.name).slice(MCP_TOOLS.length + 2));
				if (block.type === "tool_result") tools[names.get(block.tool_use_id) ?? block.tool_use_id] = JSON.parse(block.content[0].text);
			}
		}
		const batches = join(ws, ".imm/state/batches");
		const common = git(ws, "rev-parse", "--path-format=absolute", "--git-common-dir").trim();
		return {
			ws,
			exitCode,
			result: stream.result?.result,
			tools,
			lanes: {
				worktrees: git(ws, "worktree", "list", "--porcelain").split("\n").filter((line) => line.startsWith("worktree ")).length,
				imm_worktree_dir: existsSync(join(common, "imm", "worktrees")),
				batch_records: existsSync(batches) ? readdirSync(batches) : [],
				herdr_events: herdr.events().map((event) => event.event),
			},
			cleanup,
		};
	} catch (error) {
		cleanup();
		throw error;
	} finally {
		herdr.teardown();
		await model.stop();
	}
}

/** Neither the tool results nor the workspace show a Lane that was created, lost or left unreadable. */
function expectNoParkedLane(run: DriveRun): void {
	expect(JSON.stringify(run.tools)).not.toMatch(/batch_lane_lost|batch_lane_unreadable/);
	expect(run.lanes.worktrees).toBe(1);
	expect(run.lanes.imm_worktree_dir).toBe(false);
	// fake-herdr saw only the Host's own pane: no Lane tab was ever created.
	expect(run.lanes.herdr_events).toEqual(["create", "start", "exit"]);
	for (const file of run.lanes.batch_records) expect(readFileSync(join(run.ws, ".imm/state/batches", file), "utf8")).not.toMatch(/batch_lane_lost|batch_lane_unreadable/);
}

const skewWarnings = (run: DriveRun) => (run.tools.status.warnings ?? []).filter((warning: { code: string }) => warning.code === "loaded_plugin_differs_from_workspace");

describe("skew", () => {
	test("a stale plugin cache against newer source shows the named diagnostic with one reload action and parks no Lane", async () => {
		const run = await drive(writeNewerPluginSource);
		try {
			expect(run.exitCode).toBe(0);
			expect(run.result).toBe("e2e-skew-done");
			const [warning, ...rest] = skewWarnings(run);
			expect(rest).toEqual([]);
			// The diagnostic names the loaded (stale) build and the newer workspace build.
			expect(warning.paths).toEqual([realpathSync(install.claudePluginDir), realpathSync(join(run.ws, "plugins/immune-brain"))]);
			// Its one recovery action: reload the Host with the workspace plugin.
			expect(warning.message.match(/reload the Host/g)).toHaveLength(1);
			expect(warning.message).toContain("reload the Host with the workspace plugin");
			expectNoParkedLane(run);
		} finally {
			run.cleanup();
		}
	}, 300_000);

	test("a batch record newer than the runtime supports shows batch_runtime_too_old with one recovery action and parks no Lane", async () => {
		let record = "";
		const run = await drive((ws) => { record = writeNewerBatchRecord(ws); });
		try {
			expect(run.exitCode).toBe(0);
			expect(run.result).toBe("e2e-skew-done");
			// status reports the record as one this runtime cannot read; start_unattended_batch names why.
			expect(run.tools.status.batch).toMatchObject({ corrupt: true, newer_contract: NEWER_CONTRACT });
			const refused = run.tools.start_unattended_batch;
			expect(refused.state).toBe("blocked");
			expect(refused.reason).toStartWith("batch_runtime_too_old: ");
			expect(refused.reason).toContain(`uses ${NEWER_CONTRACT}, newer than this runtime supports (batch_run_state/v3)`);
			expect(refused.reason).toContain(`runtime loaded from ${realpathSync(install.claudePluginDir)}`);
			expect(refused.recovery_action).toBe("reconnect the immune-brain MCP server or upgrade the plugin so the loaded runtime supports this batch record, then retry in the current Host");
			// The refusal rewrites nothing: the newer record is left exactly as the newer runtime wrote it.
			expect(JSON.parse(readFileSync(record, "utf8"))).toEqual({ contract: NEWER_CONTRACT, initiative_slug: TASK_ID, batch_id: "batch-skew" });
			expect(run.lanes.batch_records).toEqual(["batch-skew.json"]);
			expectNoParkedLane(run);
		} finally {
			run.cleanup();
		}
	}, 300_000);

	test("control: with no skew neither diagnostic appears", async () => {
		const run = await drive(() => {});
		try {
			expect(run.exitCode).toBe(0);
			expect(skewWarnings(run)).toEqual([]);
			expect(run.tools.status.batch).toBeUndefined();
			expect(JSON.stringify(run.tools)).not.toContain("batch_runtime_too_old");
			expectNoParkedLane(run);
		} finally {
			run.cleanup();
		}
	}, 300_000);
});
