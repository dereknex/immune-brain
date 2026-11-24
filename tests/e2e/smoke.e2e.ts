// J0 smoke: the tarball install root, the scripted mock model, the pinned claude binary and
// the spawning fake-herdr work together end to end (Spec e2e-release-gate D2-D4, S2-AC1).
// Run with `bun run e2e smoke`; the pinned claude binary must be installed (absent fails).

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type HerdrEvent, FakeHerdr, claudeLaunch, parseClaudeStream, resolveClaude } from "./harness/hosts";
import { type InstallRoot, createInstallRoot } from "./harness/install-root";
import { type CassetteTurn, assertNoFailures, parseCassette, startMockModel } from "./harness/mock-model";
import { redactText, startJourneyModel, startRecorder } from "./harness/recorder";

const PROMPT = "Reply with the scripted smoke answer.";
let install: InstallRoot;
let claude: { bin: string; version: string };

beforeAll(async () => {
	claude = await resolveClaude();
	install = await createInstallRoot();
}, 300_000);
afterAll(() => install?.cleanup());

/** Launches the pinned claude in a fake-herdr pane against `turns` (or the smoke cassette). */
async function runClaude(turns?: CassetteTurn[]) {
	const model = await startJourneyModel("smoke", "claude", turns);
	const herdr = FakeHerdr.create();
	const work = mkdtempSync(join(tmpdir(), "imm-e2e-work-"));
	try {
		const homeDir = join(work, "home");
		mkdirSync(homeDir);
		const launch = claudeLaunch({ bin: claude.bin, pluginDir: install.claudePluginDir, modelUrl: model.url, prompt: PROMPT, homeDir, apiKey: model.apiKey });
		const { pane } = await herdr.launch({ label: "smoke-claude", cwd: work, launch });
		const exitCode = await herdr.waitForExit(pane, 120_000);
		const stream = parseClaudeStream(await herdr.output(pane));
		return { model, stream, exitCode, events: herdr.events() as HerdrEvent[] };
	} finally {
		herdr.teardown();
		await model.stop();
		rmSync(work, { recursive: true, force: true });
	}
}

describe("smoke", () => {
	test("completes a one-turn scripted exchange with the built plugin loaded from the tarball install root", async () => {
		const run = await runClaude();
		expect(run.exitCode).toBe(0);
		// The Host loaded the plugin from the extracted tarball, and its MCP server connected.
		const plugin = run.stream.init?.plugins?.find((entry: { name: string }) => entry.name === "immune-brain");
		expect(plugin?.path).toBe(install.claudePluginDir);
		expect(run.stream.init?.mcp_servers).toContainEqual(expect.objectContaining({ name: "plugin:immune-brain:immune-brain", status: "connected" }));
		// The exchange ran against the mock through ANTHROPIC_BASE_URL and consumed exactly the scripted turn.
		if (run.model.mock) {
			expect(run.stream.result?.result).toBe("e2e-smoke-ok");
			expect(run.model.mock.requests).toHaveLength(1);
			assertNoFailures(run.model.mock);
		} else {
			expect(run.stream.result?.result).toBeTruthy();
		}
		// fake-herdr spawned the Host and logged its lifecycle.
		expect(run.events.map((event) => event.event)).toEqual(["create", "start", "exit"]);
		expect(run.events.at(-1)).toMatchObject({ code: 0 });
	}, 300_000);

	test("a cassette tool the request does not offer fails with cassette_mismatch", async () => {
		const turns = parseCassette(JSON.stringify({ turn: 0, after: [], tools: ["Unoffered_Tool"], content: [{ type: "tool_use", id: "toolu_smoke_0", name: "Unoffered_Tool", input: {} }], stop_reason: "tool_use" }));
		const run = await runClaude(turns);
		expect(run.model.mock?.failures[0]?.code).toBe("cassette_mismatch");
		expect(run.model.mock?.failures[0]?.message).toContain("turn 0");
		expect(run.model.mock?.failures[0]?.message).toContain("Unoffered_Tool");
		expect(() => assertNoFailures(run.model.mock!)).toThrow(/cassette_mismatch/);
		expect(run.stream.result?.result).not.toBe("e2e-smoke-ok");
	}, 300_000);
});

describe("recorder", () => {
	test("passes a streamed exchange through and writes a redacted cassette", async () => {
		const leaky = "ran in /Users/someone/project at 2026-01-02T03:04:05.678Z with sk-ant-api03-SECRET_VALUE";
		const upstream = await startMockModel({ turns: parseCassette(JSON.stringify({ turn: 0, after: [], tools: [], content: [{ type: "text", text: leaky }], stop_reason: "end_turn" })) });
		const dir = mkdtempSync(join(tmpdir(), "imm-e2e-rec-"));
		const path = join(dir, "recorded.jsonl");
		const recorder = await startRecorder({ cassettePath: path, upstream: upstream.url });
		try {
			const response = await fetch(`${recorder.url}/v1/messages`, { method: "POST", body: JSON.stringify({ model: "m", stream: true, messages: [{ role: "user", content: "hi" }], tools: [] }) });
			expect(await response.text()).toContain("SECRET_VALUE");
		} finally {
			await recorder.stop();
			await upstream.stop();
		}
		const [turn] = parseCassette(readFileSync(path, "utf8"));
		rmSync(dir, { recursive: true, force: true });
		expect(turn.content[0].text).toBe("ran in <home>/project at <timestamp> with <redacted-secret>");
		expect(redactText("/home/ci/x")).toBe("<home>/x");
	}, 60_000);
});
