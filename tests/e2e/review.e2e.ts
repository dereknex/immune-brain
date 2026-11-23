// J3 review: a material-risk scripted task dispatches a reviewer whose receipt arrives through the
// MCP tool and is recorded as a verdict; a reviewer that ends without a receipt yields the named
// refusal and no verdict (Spec e2e-release-gate D2-D4, S5-AC1, SCN-6).
// Run with `bun run e2e review`; the pinned claude binary must be installed (absent fails).
//
// The Parent and the Lane Executor are driven directly over the plugin's MCP server (the test is
// the Host's MCP client); the reviewer is a real pinned claude launched through the plugin's own
// `imm-session` command against the scripted mock model. Black box: no runtime imports.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { FakeHerdr, baseEnv, claudeLaunch, resolveClaude } from "./harness/hosts";
import { type InstallRoot, createInstallRoot } from "./harness/install-root";
import { type CassetteTurn, type MockModel, assertNoFailures, cassettePath, parseCassette, startMockModel } from "./harness/mock-model";

type Json = Record<string, any>;
const TASK = "e2e-review-task";
const TOOL_PREFIX = "mcp__plugin_immune-brain_immune-brain__";
const SUBMIT_RESULT = `${TOOL_PREFIX}submit_session_result`;
const FIXTURES = resolve(import.meta.dir, "../fixtures/fake-herdr");
const WORKSPACE = "w-e2e";

let install: InstallRoot;
let claude: { bin: string; version: string };

beforeAll(async () => {
	claude = await resolveClaude();
	install = await createInstallRoot();
}, 300_000);
afterAll(() => install?.cleanup());

/** One plugin MCP server process spoken to over newline-delimited JSON-RPC, with Claude's hook relay. */
class McpClient {
	private child!: ReturnType<typeof Bun.spawn>;
	private buffer = "";
	private nextId = 1;
	private readonly pending = new Map<number, (message: Json) => void>();
	private stderr = "";

	constructor(private readonly input: { pluginDir: string; cwd: string; env: Record<string, string>; session: string }) {}

	private get entry(): string {
		return join(this.input.pluginDir, "dist/claude/mcp-server.mjs");
	}

	async start(): Promise<this> {
		this.child = Bun.spawn(["node", this.entry], { cwd: this.input.cwd, stdin: "pipe", stdout: "pipe", stderr: "pipe", env: this.input.env });
		void this.pump();
		void (async () => { for await (const chunk of this.child.stderr as ReadableStream<Uint8Array>) this.stderr += new TextDecoder().decode(chunk); })();
		await this.request("initialize", { protocolVersion: "2025-06-18", clientInfo: { name: "claude-code", version: claude.version }, capabilities: { elicitation: {} } });
		this.send({ jsonrpc: "2.0", method: "notifications/initialized" });
		return this;
	}

	private send(message: Json): void {
		const stdin = this.child.stdin as { write(data: string): void; flush(): void };
		stdin.write(JSON.stringify(message) + "\n");
		stdin.flush();
	}

	private async pump(): Promise<void> {
		for await (const chunk of this.child.stdout as ReadableStream<Uint8Array>) {
			this.buffer += new TextDecoder().decode(chunk);
			let newline: number;
			while ((newline = this.buffer.indexOf("\n")) >= 0) {
				const line = this.buffer.slice(0, newline).trim();
				this.buffer = this.buffer.slice(newline + 1);
				if (!line) continue;
				const message = JSON.parse(line) as Json;
				if (message.method === "elicitation/create") {
					// The native authority gate: the user accepts it.
					this.send({ jsonrpc: "2.0", id: message.id, result: { action: "accept", content: {} } });
				} else if (message.id !== undefined) {
					this.pending.get(message.id)?.(message);
					this.pending.delete(message.id);
				}
			}
		}
	}

	private request(method: string, params: Json, timeoutMs = 300_000): Promise<Json> {
		const id = this.nextId++;
		return new Promise((resolveReply, reject) => {
			const timer = setTimeout(() => reject(new Error(`mcp_timeout: ${method} did not answer in ${timeoutMs} ms; stderr: ${this.stderr.slice(-1500)}`)), timeoutMs);
			this.pending.set(id, (message) => { clearTimeout(timer); resolveReply(message); });
			this.send({ jsonrpc: "2.0", id, method, params });
		});
	}

	/** Runs the plugin's own `--hook` entry with one payload, as Claude Code does. */
	async hook(payload: Json): Promise<void> {
		const child = Bun.spawn(["node", this.entry, "--hook"], { cwd: this.input.cwd, stdin: "pipe", stdout: "pipe", stderr: "pipe", env: this.input.env });
		(child.stdin as { write(data: string): void; end(): void }).write(JSON.stringify({ cwd: this.input.cwd, session_id: this.input.session, ...payload }));
		(child.stdin as { end(): void }).end();
		const [, , code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
		if (code !== 0) throw new Error(`hook_failed: exit ${code}`);
	}

	/** One tool call, admitted by the PreToolUse hook first so the server sees the Claude correlation id. */
	async call(name: string, args: Json): Promise<Json> {
		const toolUseId = `toolu_e2e_${this.nextId}`;
		await this.hook({ hook_event_name: "PreToolUse", tool_name: TOOL_PREFIX + name, tool_use_id: toolUseId, tool_input: args });
		const reply = await this.request("tools/call", { name, arguments: args, _meta: { "claudecode/toolUseId": toolUseId } });
		if (reply.error) throw new Error(`${name} failed: ${JSON.stringify(reply.error)}`);
		const text = (reply.result?.content ?? []).find((item: Json) => item.type === "text")?.text ?? "";
		return JSON.parse(text);
	}

	async stop(): Promise<void> {
		try { (this.child.stdin as { end(): void }).end(); } catch { /* already closed */ }
		this.child.kill("SIGKILL");
		await this.child.exited;
	}
}

/**
 * A `herdr` in front of the fake one. The fake only records `agent prompt` and runs the
 * `agent start` argv as a command; a real Host starts from its kind and consumes the entry.
 * The shim starts the pinned claude as `claude -p <entry> <start args>` when the entry arrives.
 */
const HERDR_SHIM = `#!/usr/bin/env bun
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const args = process.argv.slice(2);
const dir = process.env.E2E_SHIM_DIR!;
if (args[0] === "--launch") {
	const [, pane, ...hostArgs] = args;
	const entry = join(dir, "entry-" + pane + ".txt");
	const deadline = Date.now() + 60000;
	while (!existsSync(entry) && Date.now() < deadline) await Bun.sleep(50);
	if (!existsSync(entry)) process.exit(3);
	const child = Bun.spawn([process.env.E2E_CLAUDE_BIN!, "-p", readFileSync(entry, "utf8"), ...hostArgs, "--output-format", "stream-json", "--verbose"], { stdout: "inherit", stderr: "inherit", env: process.env });
	process.exit(await child.exited);
}
let forwarded = args;
if (args[0] === "agent" && args[1] === "start") {
	const split = args.indexOf("--");
	forwarded = [...args.slice(0, split + 1), process.execPath, import.meta.path, "--launch", args[args.indexOf("--pane") + 1], ...args.slice(split + 1)];
}
if (args[0] === "agent" && args[1] === "prompt") writeFileSync(join(dir, "entry-" + args[2] + ".txt"), args[3]);
const result = spawnSync(process.env.E2E_REAL_HERDR!, forwarded, { env: process.env, encoding: "utf8" });
process.stdout.write(result.stdout ?? "");
process.stderr.write(result.stderr ?? "");
process.exit(result.status ?? 1);
`;

async function shell(command: string, cwd: string, env: Record<string, string>): Promise<{ code: number; stdout: string; stderr: string }> {
	const child = Bun.spawn(["sh", "-c", command], { cwd, env, stdout: "pipe", stderr: "pipe" });
	const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
	return { code, stdout, stderr };
}

/** The cassette turns for one reviewer, with the per-run values the Kernel minted filled in. */
function reviewerTurns(values: Record<string, string>, receipt: boolean): CassetteTurn[] {
	if (!receipt) {
		return parseCassette(JSON.stringify({ turn: 0, after: [], tools: [], content: [{ type: "text", text: "Nothing to submit." }], stop_reason: "end_turn" }));
	}
	const text = readFileSync(cassettePath("review", "claude"), "utf8");
	return parseCassette(Object.entries(values).reduce((out, [key, value]) => out.split(`{{${key}}}`).join(value), text), "review cassette");
}

interface Journey {
	reviewReady: Json;
	submit: Json;
	status: Json;
	await: Json;
	model: MockModel;
}

/** Runs the material-risk task to Review dispatch, plays the reviewer, then submits the review. */
async function runJourney(receipt: boolean): Promise<Journey> {
	const work = realpathSync(mkdtempSync(join(tmpdir(), "imm-e2e-review-")));
	const herdr = FakeHerdr.create(WORKSPACE);
	const clients: McpClient[] = [];
	let model: MockModel | undefined;
	try {
		const [repo, home, tmp, shim] = ["repo", "home", "tmp", "shim"].map((name) => join(work, name));
		for (const dir of [repo, home, tmp, shim]) mkdirSync(dir);
		const git = (...argv: string[]) => execFileSync("git", ["-C", repo, "-c", "user.name=e2e", "-c", "user.email=e2e@example.com", ...argv], { encoding: "utf8" });

		// A material-risk TaskIntent with one acceptance the Kernel can verify deterministically.
		const verification = { contract: "assurance_kernel/verification_descriptor/v2", command: { executable: "bun", argv: ["-e", "process.exit(0)"], cwd: ".", timeout_ms: 60_000, max_output_bytes: 4096 }, environment: { prepare: null, writable_paths: [] } };
		mkdirSync(join(repo, "docs/plans"), { recursive: true });
		mkdirSync(join(repo, ".imm"));
		writeFileSync(join(repo, ".gitignore"), ".imm/state/\n");
		writeFileSync(join(repo, "base.txt"), "base\n");
		writeFileSync(join(repo, `docs/plans/${TASK}.intent.json`), JSON.stringify({ contract: "assurance_kernel/task_intent/v1", task_id: TASK, owner: "user", goal: "Deliver the scripted review task", acceptance: [{ id: "A1", assertion: "A1 holds", verification: JSON.stringify(verification) }], scope_hint: ["delivery.txt"], risk: "material", revision: 1 }) + "\n");
		writeFileSync(join(repo, ".imm/config.json"), JSON.stringify({ contract: "immune_brain/project_config/v2", git_integration: "manual", agents: { executor: { host: "claude-code" }, reviewer: { host: "claude-code" } } }));
		git("init", "-q", "-b", "main");
		git("add", "-A");
		git("commit", "-qm", "base");

		const herdrEnv = { FAKE_HERDR_STATE: herdr.stateFile, HERDR_ENV: "1", HERDR_WORKSPACE_ID: WORKSPACE };
		const env = { ...baseEnv(), HOME: home, TMPDIR: tmp, ...herdrEnv, PATH: `${FIXTURES}${delimiter}${baseEnv().PATH ?? ""}` };

		// Parent: confirm the batch; the runtime enrolls the Lane.
		const parent = await new McpClient({ pluginDir: install.claudePluginDir, cwd: repo, env, session: "e2e-parent" }).start();
		clients.push(parent);
		await parent.hook({ hook_event_name: "UserPromptSubmit", prompt: `/immune-brain:drive ${TASK}` });
		const started = await parent.call("start_unattended_batch", { task_id: TASK });
		expect(started.state).toBe("started");
		const lane = started.report.children[0].lane.path as string;

		// Executor: deliver the change in the Lane and ask for assurance.
		const executor = await new McpClient({ pluginDir: install.claudePluginDir, cwd: lane, env, session: "e2e-executor" }).start();
		clients.push(executor);
		writeFileSync(join(lane, "delivery.txt"), "delivered\n");
		execFileSync("git", ["-C", lane, "add", "delivery.txt"]);
		// The Kernel's QA scan of the verification process can time out on a loaded host; its own
		// recovery for that environment failure is to call advance_assurance again.
		let reviewReady = await executor.call("advance_assurance", { task_id: TASK });
		for (let attempt = 1; attempt < 3 && reviewReady.state === "failed" && reviewReady.environment_failure === true; attempt++) {
			reviewReady = await executor.call("advance_assurance", { task_id: TASK });
		}
		expect(reviewReady).toMatchObject({ state: "review_ready", operation: "review" });
		const session = reviewReady.review_session as { create_command: string; await_command: string };
		const slotId = /slot_id "([^"]+)"/.exec(session.create_command)?.[1];
		if (!slotId) throw new Error("review_session create_command names no slot_id");

		// Reviewer: the pinned claude, started by the plugin's own imm-session command.
		model = await startMockModel({ turns: reviewerTurns({ slot_id: slotId, task_id: TASK, snapshot_digest: reviewReady.snapshot_digest }, receipt) });
		const launch = claudeLaunch({ bin: claude.bin, pluginDir: install.claudePluginDir, modelUrl: model.url, prompt: "", homeDir: home });
		writeFileSync(join(shim, "herdr"), HERDR_SHIM);
		chmodSync(join(shim, "herdr"), 0o755);
		const shellEnv = { ...env, ...launch.env, PATH: `${shim}${delimiter}${env.PATH}`, E2E_SHIM_DIR: shim, E2E_REAL_HERDR: join(FIXTURES, "herdr"), E2E_CLAUDE_BIN: claude.bin };
		const created = await shell(session.create_command, lane, shellEnv);
		expect(created.code).toBe(0);
		const handle = JSON.parse(created.stdout).handle as string;
		const awaited = await shell(session.await_command.split("<handle>").join(handle), lane, shellEnv);
		expect(awaited.code).toBe(0);

		const submit = await executor.call("submit_review", { task_id: TASK });
		const status = await executor.call("status", { task_id: TASK });
		return { reviewReady, submit, status, await: JSON.parse(awaited.stdout.slice(0, awaited.stdout.indexOf("}") + 1)), model };
	} finally {
		await Promise.all(clients.map((client) => client.stop()));
		herdr.teardown();
		await model?.stop();
		rmSync(work, { recursive: true, force: true });
	}
}

describe("review", () => {
	test("the reviewer's receipt arrives through the MCP tool and the verdict is recorded", async () => {
		const run = await runJourney(true);
		// The scripted reviewer called the receipt tool once and finished; nothing was refused.
		expect(run.await).toMatchObject({ ok: true, state: "done" });
		expect(run.model.requests.map((request) => request.turn)).toEqual([0, 1]);
		expect(run.model.requests[0].offeredTools).toContain(SUBMIT_RESULT);
		assertNoFailures(run.model);
		// The Kernel applied that receipt as the Review verdict.
		expect(run.submit.state).toBe("completed");
		expect(run.status.projection.missing_approval_kinds).not.toContain("review");
		expect(run.status.projection.lifecycle).toBe("done");
	}, 600_000);

	test("a reviewer that ends without submitting a receipt yields review_session_aborted and no verdict", async () => {
		const run = await runJourney(false);
		expect(run.await).toMatchObject({ ok: true, state: "done" });
		assertNoFailures(run.model);
		expect(run.submit.state).toBe("blocked");
		expect(run.submit.reason).toContain("review_session_aborted");
		expect(run.status.projection.fresh_approval_kinds).not.toContain("review");
		expect(run.status.projection.missing_approval_kinds).toContain("review");
		expect(run.status.projection.lifecycle).toBe("active");
	}, 600_000);
});
