// A confirmation preview that throws still fails closed (no grant, `allow`), but
// names its cause, and a runtime refuses overlapping previews because they swap
// its confirmation port.

import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { AntigravityRuntime } from "../plugins/immune-brain/runtime/antigravity/kernel_ports";
import { antigravityPreToolUseHookAsync } from "../plugins/immune-brain/runtime/antigravity/lane_guard";

const dirs: string[] = [];
function temp(label: string): string {
	const dir = realpathSync(mkdtempSync(join(tmpdir(), `imm-preview-${label}-`)));
	dirs.push(dir);
	return dir;
}
const probeHost = () => ({ ok: true as const, version: "1.0.0", platform: process.platform });

afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("Antigravity confirmation preview", () => {
	test("a throwing preview reports its cause on stderr and fails closed", async () => {
		const workspace = temp("ws");
		const store = temp("store");
		mkdirSync(join(workspace, ".imm"));
		const written: string[] = [];
		const realWrite = process.stderr.write;
		process.stderr.write = ((chunk: unknown) => {
			written.push(String(chunk));
			return true;
		}) as typeof process.stderr.write;
		let result: { decision: string };
		try {
			result = await antigravityPreToolUseHookAsync({
				conversationId: "conv-1",
				stepIdx: 3,
				workspacePaths: [workspace],
				toolCall: {
					name: "call_mcp_tool",
					args: { ServerName: "immune-brain", ToolName: "request_authorization", Arguments: { task_id: "no-such-task" } },
				},
			}, { root: store });
		} finally {
			process.stderr.write = realWrite;
		}
		expect(result.decision).toBe("allow");
		expect(written.join("")).toMatch(/PreToolUse preview for request_authorization failed: .+/);
	});

	test("a runtime refuses a second preview while one is running, then recovers", async () => {
		const workspace = temp("ws");
		const runtime = new AntigravityRuntime({ cwd: workspace, env: {}, interactive: true, probeHost });
		const meta = { sessionId: "s", toolCallId: "c", taskId: "init", initiativeSlug: "init", interactive: true };
		try {
			const settled = await Promise.allSettled([
				runtime.previewBatchRetirement("init", meta),
				runtime.previewBatchRetirement("init", meta),
			]);
			expect(settled.map((entry) => entry.status).sort()).toEqual(["fulfilled", "rejected"]);
			const rejected = settled.find((entry) => entry.status === "rejected") as PromiseRejectedResult;
			expect(String(rejected.reason)).toContain("already running");
			// The guard is released: a later preview runs normally.
			await expect(runtime.previewBatchRetirement("init", meta)).resolves.toBeNull();
		} finally {
			await runtime.shutdown();
		}
	});
});
