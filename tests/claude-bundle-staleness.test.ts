import { afterEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { consumePhaseAdmission, phaseEntryGateHookOutput, recordPhaseEntryPrompt, type GatedTool } from "../plugins/immune-brain/runtime/claude/lane_guard";
import { createMcpRuntime, handleJsonRpc } from "../plugins/immune-brain/runtime/claude/mcp_server";
import { watchBundleIdentity } from "../plugins/immune-brain/runtime/plugin_source_skew";
import { readActiveClaimTaskId } from "../plugins/immune-brain/runtime/unattended/batch_preflight";

// Spec branch-boundary D3: the long-lived MCP server refuses authority calls
// once its own bundle changed on disk, ahead of the phase entry gate.
const ENV = { CLAUDE_CODE_VERSION: "2.1.236", CLAUDE_CODE_PERMISSION_MODE: "manual" };
const TOOL = (name: string) => `mcp__plugin_immune-brain_immune-brain__${name}`;
const GATED: GatedTool[] = ["enroll", "start_unattended_batch", "retire_stale_batch"];
const AUTHORITY = [...GATED, "advance_assurance", "submit_review"] as const;
const roots: string[] = [];

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function temp(prefix: string): string {
	const dir = mkdtempSync(join(tmpdir(), prefix));
	roots.push(dir);
	return dir;
}

function workspace(taskId: string): string {
	const root = temp("imm-bundle-stale-");
	execFileSync("git", ["init", "-q", "-b", "main"], { cwd: root });
	execFileSync("git", ["config", "user.name", "Test"], { cwd: root });
	execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: root });
	mkdirSync(join(root, "docs", "plans"), { recursive: true });
	writeFileSync(join(root, ".gitignore"), ".imm/state/\n");
	writeFileSync(join(root, "docs", "plans", `${taskId}.intent.json`), `${JSON.stringify({
		contract: "assurance_kernel/task_intent/v1",
		task_id: taskId,
		owner: "user",
		goal: `goal for ${taskId}`,
		acceptance: [{ id: "acc-1", assertion: `assertion for ${taskId}`, verification: "bun test" }],
		scope_hint: [`docs/plans/${taskId}.intent.json`, `docs/specs/${taskId}.spec.md`, `docs/specs/archive/${taskId}.spec.md`],
		risk: "routine",
		revision: 1,
	}, null, 2)}\n`);
	execFileSync("git", ["add", "-A"], { cwd: root });
	execFileSync("git", ["commit", "-q", "-m", "fixture"], { cwd: root });
	return root;
}

async function session() {
	const cwd = workspace("stale-a");
	const store = temp("imm-bundle-store-");
	const bundlePath = join(temp("imm-bundle-file-"), "mcp-server.mjs");
	writeFileSync(bundlePath, "// build 1\n");
	const base = { session_id: "stale-session", cwd };
	const locations = { root: store, home: store };
	let consumed = 0;
	let gateCalls = 0;
	let rpcId = 1;
	const mcp = createMcpRuntime({
		cwd, env: ENV,
		bundleIdentity: watchBundleIdentity(bundlePath),
		requestConfirmation: async ({ operation }) => { gateCalls++; return { decision: "accept", requestId: `gate-${operation}-${gateCalls}` }; },
		consumePhaseAdmission: (toolCallId: string, operation: GatedTool) => {
			const admitted = consumePhaseAdmission(toolCallId, operation, store);
			if (admitted) consumed++;
			return admitted;
		},
	});
	await handleJsonRpc({
		jsonrpc: "2.0", id: rpcId++, method: "initialize",
		params: { protocolVersion: "2025-06-18", clientInfo: { name: "claude-code", version: "2.1.236" }, capabilities: { elicitation: {} } },
	}, mcp);
	return {
		cwd,
		bundlePath,
		consumed: () => consumed,
		gateCalls: () => gateCalls,
		prompt: (prompt: string) => recordPhaseEntryPrompt({ hook_event_name: "UserPromptSubmit", prompt, ...base }, locations),
		hook: (name: string, tool_use_id: string) =>
			phaseEntryGateHookOutput({ hook_event_name: "PreToolUse", tool_name: TOOL(name), tool_input: {}, tool_use_id, ...base }, locations),
		call: (name: string, args: Record<string, unknown>, toolUseId: string) =>
			handleJsonRpc({ jsonrpc: "2.0", id: rpcId++, method: "tools/call", params: { name, arguments: args, _meta: { "claudecode/toolUseId": toolUseId } } }, mcp),
	};
}

const argsFor = (name: string) => name === "start_unattended_batch" || name === "retire_stale_batch" ? { initiative_slug: "stale-init" } : { task_id: "stale-a" };

function expectStale(reply: Awaited<ReturnType<typeof handleJsonRpc>>): void {
	expect(reply?.result).toBeUndefined();
	expect(reply?.error?.data?.reason_code).toBe("plugin_bundle_stale");
	expect(String(reply?.error?.data?.recovery_action)).toContain("reconnect the immune-brain MCP server");
}

describe("Claude MCP server bundle staleness", () => {
	test("a changed bundle refuses every authority call before an admission is consumed and with no Kernel mutation", async () => {
		const s = await session();
		s.prompt("/imm-run stale-a");
		writeFileSync(s.bundlePath, "// build 2, a longer bundle\n");
		for (const name of AUTHORITY) {
			const id = `toolu_${name}`;
			if ((GATED as readonly string[]).includes(name)) expect(s.hook(name, id)).toBeNull();
			expectStale(await s.call(name, argsFor(name), id));
		}
		expect(s.consumed()).toBe(0);
		expect(s.gateCalls()).toBe(0);
		expect(readActiveClaimTaskId(s.cwd)).toBeNull();
		expect(existsSync(join(s.cwd, ".imm", "state", "tasks"))).toBe(false);
	});

	test("an unchanged bundle behaves as before, including a touch that keeps its bytes", async () => {
		const s = await session();
		const later = new Date(Date.now() + 60_000);
		utimesSync(s.bundlePath, later, later);
		s.prompt("/imm-run stale-a");
		expect(s.hook("enroll", "toolu_enroll")).toBeNull();
		const enrolled = await s.call("enroll", { task_id: "stale-a" }, "toolu_enroll");
		expect(enrolled?.error).toBeUndefined();
		expect(s.gateCalls()).toBe(1);
		expect(readActiveClaimTaskId(s.cwd)).toBe("stale-a");
		for (const name of ["advance_assurance", "submit_review"]) {
			const reply = await s.call(name, { task_id: "stale-a" }, `toolu_${name}`);
			expect(reply?.error?.data?.reason_code).not.toBe("plugin_bundle_stale");
		}
	});

	test("status still answers on a stale bundle and carries the warning", async () => {
		const s = await session();
		writeFileSync(s.bundlePath, "// build 2\n");
		const reply = await s.call("status", { task_id: "stale-a" }, "toolu_status");
		expect(reply?.error).toBeUndefined();
		const body = JSON.parse((reply?.result as { content: Array<{ text: string }> }).content[0]!.text) as { task_id: string; warnings?: Array<{ code: string; paths: string[] }> };
		expect(body.task_id).toBe("stale-a");
		expect(body.warnings?.find((warning) => warning.code === "plugin_bundle_stale")?.paths).toEqual([s.bundlePath]);
	});

	test("an unreadable bundle at check time refuses with the same reason code", async () => {
		const s = await session();
		rmSync(s.bundlePath);
		s.prompt("/imm-run stale-a");
		expect(s.hook("enroll", "toolu_gone")).toBeNull();
		expectStale(await s.call("enroll", { task_id: "stale-a" }, "toolu_gone"));
		expect(s.consumed()).toBe(0);
	});
});
