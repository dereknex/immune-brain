// bun run e2e:live writes schema-valid live evidence (Spec e2e-release-gate D6, S9-AC1). The real
// Hosts and the real model need the maintainer's logins and API key, so here the scripted mock model
// stands in for the model: each journey attempt is one exchange with it, and the runner, its retry,
// its evidence file and its low-cost model substitution are the real code under test.

import { afterAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { REQUIRED_LIVE_JOURNEYS, liveEvidenceFindings } from "../scripts/release-promote";
import { LIVE_MODEL_TIER, LIVE_PLAN, type JourneyRunner, judgeBunTest, main, runLive } from "./e2e/live/run-live";
import { parseCassette } from "./e2e/harness/mock-model";
import { startMockModel } from "./e2e/harness/mock-model";
import { rewriteRequestModel, startRecorder } from "./e2e/harness/recorder";

const ROOT = resolve(import.meta.dir, "..");

const scratch: string[] = [];
const tempDir = (): string => {
	const dir = mkdtempSync(join(tmpdir(), "imm-e2e-live-"));
	scratch.push(dir);
	return dir;
};
afterAll(() => scratch.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

const HOSTS = { claude: "2.1.330", pi: "1.5.2", herdr: "0.9.5" };
const COMMIT = "a".repeat(40);
const ONE_TURN = [{ turn: 0, after: [], tools: [], content: [{ type: "text" as const, text: "scripted live answer" }], stop_reason: "end_turn" as const }];
const sha256 = (text: string): string => createHash("sha256").update(text).digest("hex");

/** One attempt = one request to a mock model; `serves(...)` decides whether this attempt's model has a scripted turn. */
function mockModelRunner(serves: (id: string, host: string, call: number) => boolean): { run: JourneyRunner; calls: string[] } {
	const calls: string[] = [];
	const run: JourneyRunner = async (plan, host) => {
		const call = calls.filter((entry) => entry === `${plan.id}/${host}`).length;
		calls.push(`${plan.id}/${host}`);
		const model = await startMockModel({ turns: serves(plan.id, host, call) ? ONE_TURN : [] });
		try {
			const response = await fetch(`${model.url}/v1/messages`, { method: "POST", body: JSON.stringify({ model: LIVE_MODEL_TIER, messages: [{ role: "user", content: "live smoke" }], tools: [] }) });
			return { passed: response.status === 200, log: `${plan.id} ${host} -> ${response.status} ${await response.text()}` };
		} finally {
			await model.stop();
		}
	};
	return { run, calls };
}

const read = (path: string) => JSON.parse(readFileSync(path, "utf8"));

describe("bun run e2e:live evidence", () => {
	test("writes <version>.json matching the evidence contract, with Host versions, per-journey results and no retries when every journey passes", async () => {
		const outDir = tempDir();
		const { run, calls } = mockModelRunner(() => true);
		const result = await runLive({ version: "9.2.0", commit: COMMIT, hosts: HOSTS, outDir, run });

		expect(result.path).toBe(join(outDir, "9.2.0.json"));
		expect(result.passed).toBe(true);
		const written = read(result.path);
		expect(written).toMatchObject({ contract: "immune_brain/e2e_release_evidence/v1", version: "9.2.0", commit: COMMIT, mode: "live", hosts: HOSTS, checklist: [] });
		expect(liveEvidenceFindings(written)).toEqual({ invalid: [], missing: [], failed: [] });
		expect(written.journeys.map((journey: { id: string; host: string }) => `${journey.id}/${journey.host}`)).toEqual(["J1/claude", "J1/pi", "J2/claude", "J2/pi", "J4/claude", "J4/pi", "J4/antigravity"]);
		for (const journey of written.journeys) {
			expect(journey.result).toBe("pass");
			expect(journey.attempts).toHaveLength(1);
			expect(journey.attempts[0]).toMatchObject({ result: "pass", duration_ms: expect.any(Number) });
			expect(journey.attempts[0].log_sha256).toMatch(/^[0-9a-f]{64}$/);
		}
		expect(calls).toHaveLength(7);
	});

	test("a journey that fails twice is recorded as failed with both attempts, and the file is still written", async () => {
		const outDir = tempDir();
		const { run, calls } = mockModelRunner((id, host) => !(id === "J1" && host === "pi"));
		const result = await runLive({ version: "9.2.0", commit: COMMIT, hosts: HOSTS, outDir, run });

		expect(result.passed).toBe(false);
		const written = read(join(outDir, "9.2.0.json"));
		const failed = written.journeys.find((journey: { id: string; host: string }) => journey.id === "J1" && journey.host === "pi");
		expect(failed.result).toBe("fail");
		expect(failed.attempts.map((entry: { result: string }) => entry.result)).toEqual(["fail", "fail"]);
		expect(calls.filter((entry) => entry === "J1/pi")).toHaveLength(2);
		// A third attempt never happens, and the other journeys are unaffected.
		expect(written.journeys.filter((journey: { result: string }) => journey.result === "pass")).toHaveLength(6);
		expect(liveEvidenceFindings(written)).toEqual({ invalid: [], missing: [], failed: ["J1/pi"] });
	});

	test("a journey that fails once and passes on the retry is recorded as passed with both attempts", async () => {
		const outDir = tempDir();
		const { run } = mockModelRunner((id, host, call) => !(id === "J2" && host === "claude" && call === 0));
		const result = await runLive({ version: "9.2.0", commit: COMMIT, hosts: HOSTS, outDir, run });

		expect(result.passed).toBe(true);
		const journey = read(result.path).journeys.find((entry: { id: string; host: string }) => entry.id === "J2" && entry.host === "claude");
		expect(journey.result).toBe("pass");
		expect(journey.attempts.map((entry: { result: string }) => entry.result)).toEqual(["fail", "pass"]);
		expect(journey.attempts[0].log_sha256).not.toBe(journey.attempts[1].log_sha256);
	});

	test("a runner that throws is a failed attempt, and an exhausted budget records one failed attempt without running anything", async () => {
		const outDir = tempDir();
		const throwing = await runLive({ version: "9.2.0", commit: COMMIT, hosts: HOSTS, outDir, plan: [LIVE_PLAN[0]], run: async () => { throw new Error("pane_not_found"); } });
		const [first] = throwing.evidence.journeys;
		expect(first.result).toBe("fail");
		expect(first.attempts).toHaveLength(2);
		expect(first.attempts[0].log_sha256).toBe(sha256("runner_error: pane_not_found"));

		const { run, calls } = mockModelRunner(() => true);
		const exhausted = await runLive({ version: "9.2.1", commit: COMMIT, hosts: HOSTS, outDir, run, budgetMs: 0 });
		expect(calls).toEqual([]);
		expect(exhausted.passed).toBe(false);
		expect(exhausted.evidence.journeys.every((journey) => journey.result === "fail" && journey.attempts.length === 1)).toBe(true);
	});

	test("the journey child passes only when bun exited 0 in time and at least one test ran and passed", () => {
		expect(judgeBunTest(0, " 2 pass\n 0 fail\nRan 2 tests across 1 file.")).toBe(true);
		expect(judgeBunTest(0, " 0 pass\n 3 skip\n 0 fail\nRan 3 tests across 1 file.")).toBe(false);
		expect(judgeBunTest(1, " 1 pass\n 1 fail")).toBe(false);
		expect(judgeBunTest(0, " 1 pass", true)).toBe(false);
	});

	test("the recorder sends the low-cost model tier upstream and still writes the cassette; without a tier the Host's model passes through", async () => {
		expect(rewriteRequestModel('{"model":"claude-sonnet-5-5","x":1}', LIVE_MODEL_TIER)).toBe(JSON.stringify({ model: LIVE_MODEL_TIER, x: 1 }));
		expect(rewriteRequestModel('{"model":"claude-sonnet-5-5"}', undefined)).toBe('{"model":"claude-sonnet-5-5"}');
		expect(rewriteRequestModel("not json", LIVE_MODEL_TIER)).toBe("not json");

		const upstream = await startMockModel({ turns: ONE_TURN });
		const cassette = join(tempDir(), "J1", "claude.jsonl");
		const recorder = await startRecorder({ cassettePath: cassette, upstream: upstream.url, model: LIVE_MODEL_TIER });
		try {
			const response = await fetch(`${recorder.url}/v1/messages`, { method: "POST", body: JSON.stringify({ model: "claude-sonnet-5-5", messages: [{ role: "user", content: "hi" }], tools: [] }) });
			// The mock echoes the model it was asked for: the upstream saw the tier, not the Host's model.
			expect((await response.json()).model).toBe(LIVE_MODEL_TIER);
		} finally {
			await recorder.stop();
			await upstream.stop();
		}
		expect(readFileSync(cassette, "utf8").trim().split("\n").map((line) => JSON.parse(line).content[0].text)).toEqual(["scripted live answer"]);
	});

	test("the command refuses with record_credentials_missing before running any journey when ANTHROPIC_API_KEY is unset", async () => {
		const saved = process.env.ANTHROPIC_API_KEY;
		delete process.env.ANTHROPIC_API_KEY;
		const errors: unknown[] = [];
		const original = console.error;
		console.error = (...args: unknown[]) => { errors.push(args.join(" ")); };
		try {
			expect(await main([])).toBe(2);
		} finally {
			console.error = original;
			if (saved !== undefined) process.env.ANTHROPIC_API_KEY = saved;
		}
		expect(String(errors[0])).toContain("record_credentials_missing");
	});

	test("LIVE_PLAN matches REQUIRED_LIVE_JOURNEYS and every host pattern selects a unique test in its journey file", () => {
		const livePairs = LIVE_PLAN.flatMap((plan) => Object.keys(plan.hosts).map((host) => `${plan.id}/${host}`)).sort();
		const requiredPairs = REQUIRED_LIVE_JOURNEYS.flatMap(([id, hosts]) => hosts.map((host) => `${id}/${host}`)).sort();
		expect(livePairs).toEqual(requiredPairs);

		for (const plan of LIVE_PLAN) {
			const source = readFileSync(join(ROOT, "tests/e2e", `${plan.file}.e2e.ts`), "utf8");
			const titles = [...source.matchAll(/^\s*(?:test|it)\(\s*(["'`])((?:\\.|(?!\1).)+)\1/gm)].map((match) => match[2]);
			const matchedSets = Object.entries(plan.hosts).map(([host, pattern]) => {
				const regex = new RegExp(pattern);
				const hits = titles.filter((title) => regex.test(title));
				expect({ journey: `${plan.id}/${host}`, pattern, hits }).toMatchObject({ hits: expect.arrayContaining([expect.any(String)]) });
				return { host, hits };
			});
			for (let i = 0; i < matchedSets.length; i += 1) {
				for (let j = i + 1; j < matchedSets.length; j += 1) {
					const overlap = matchedSets[i].hits.filter((title) => matchedSets[j].hits.includes(title));
					expect({ journey: plan.id, hosts: [matchedSets[i].host, matchedSets[j].host], overlap }).toMatchObject({ overlap: [] });
				}
			}
		}
	});

	test("multi-session recording keeps distinct sessions separate and captures offeredTools on recorder.requests", async () => {
		const upstream = await startMockModel({
			turns: [
				{ turn: 0, after: [], tools: [], conv: "main", content: [{ type: "text", text: "from-session-a" }], stop_reason: "end_turn" },
				{ turn: 0, after: [], tools: [], conv: "exec", entry: "second", content: [{ type: "text", text: "from-session-b" }], stop_reason: "end_turn" },
			],
		});
		const cassette = join(tempDir(), "multi", "claude.jsonl");
		const recorder = await startRecorder({ cassettePath: cassette, upstream: upstream.url });
		try {
			await fetch(`${recorder.url}/v1/messages`, {
				method: "POST",
				headers: { "x-claude-code-session-id": "sess-a" },
				body: JSON.stringify({ model: "m", messages: [{ role: "user", content: "first" }], tools: [{ name: "ToolA" }] }),
			});
			await fetch(`${recorder.url}/v1/messages`, {
				method: "POST",
				headers: { "x-claude-code-session-id": "sess-b" },
				body: JSON.stringify({ model: "m", messages: [{ role: "user", content: "second" }], tools: [{ name: "ToolB" }] }),
			});
		} finally {
			await recorder.stop();
			await upstream.stop();
		}
		expect(recorder.requests.map((req) => ({ conv: req.conv, turn: req.turn, offeredTools: req.offeredTools }))).toEqual([
			{ conv: "main", turn: 0, offeredTools: ["ToolA"] },
			{ conv: "conv-2", turn: 0, offeredTools: ["ToolB"] },
		]);
		const recorded = parseCassette(readFileSync(cassette, "utf8"));
		expect(recorded).toHaveLength(2);
		expect(recorded.map((turn) => [turn.conv, turn.content[0].text])).toEqual([
			["main", "from-session-a"],
			["conv-2", "from-session-b"],
		]);
	});
});
