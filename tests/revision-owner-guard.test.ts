// Revision-owner guard (Spec ceremony-trim-r647 T3, D7-D8, invariant I6): a
// session whose latest entry is a plan entry cannot edit files inside the scope
// of the task a workspace has active. Cases drive the real hook functions over a
// real enrolled claim; only the private entry store location is a fixture.
import { afterEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	consumePhaseAdmission,
	phaseEntryGateHookOutput,
	recordPhaseEntryPrompt,
	revisionOwnerHookOutput,
	type GatedTool,
} from "../plugins/immune-brain/runtime/claude/lane_guard";
import { createMcpRuntime, handleJsonRpc } from "../plugins/immune-brain/runtime/claude/mcp_server";
import { REVISION_OWNER_RECOVERY, revisionOwnerRefusal } from "../plugins/immune-brain/runtime/assurance/revision_owner";
import { NO_PHASE_ENTRY } from "../plugins/immune-brain/runtime/assurance/phase_entry";
import { readActiveClaimTaskId } from "../plugins/immune-brain/runtime/unattended/batch_preflight";

const ENV = { CLAUDE_CODE_VERSION: "2.1.236", CLAUDE_CODE_PERMISSION_MODE: "manual" };
const ENROLL = "mcp__plugin_immune-brain_immune-brain__enroll";
const TASK = "owner-task";
const roots: string[] = [];

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function workspace(): string {
	const root = mkdtempSync(join(tmpdir(), "imm-owner-"));
	roots.push(root);
	execFileSync("git", ["init", "-q", "-b", "main"], { cwd: root });
	execFileSync("git", ["config", "user.name", "Test"], { cwd: root });
	execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: root });
	mkdirSync(join(root, ".imm", "state"), { recursive: true });
	mkdirSync(join(root, "docs", "plans"), { recursive: true });
	mkdirSync(join(root, "src", "mod"), { recursive: true });
	writeFileSync(join(root, ".gitignore"), ".imm/state/\n");
	writeFileSync(join(root, "src", "mod", "a.ts"), "export const a = 1;\n");
	writeFileSync(join(root, "src", "other.ts"), "export const other = 1;\n");
	writeFileSync(join(root, "docs", "plans", `${TASK}.intent.json`), `${JSON.stringify({
		contract: "assurance_kernel/task_intent/v1",
		task_id: TASK,
		owner: "user",
		goal: `goal for ${TASK}`,
		acceptance: [{ id: "acc-1", assertion: "assertion", verification: "bun test" }],
		scope_hint: ["src/mod/a.ts", `docs/plans/${TASK}.intent.json`, `docs/specs/${TASK}.spec.md`],
		risk: "routine",
		revision: 1,
	}, null, 2)}\n`);
	execFileSync("git", ["add", "-A"], { cwd: root });
	execFileSync("git", ["commit", "-q", "-m", "fixture"], { cwd: root });
	return root;
}

async function session(enroll: boolean) {
	const cwd = workspace();
	const store = mkdtempSync(join(tmpdir(), "imm-owner-store-"));
	roots.push(store);
	const base = { session_id: "owner-session", cwd };
	const locations: { root: string; home: string; read?: () => never } = { root: store, home: store };
	let rpcId = 1;
	const mcp = createMcpRuntime({
		cwd, env: ENV,
		requestConfirmation: async ({ operation }) => ({ decision: "accept", requestId: `gate-${operation}` }),
		consumePhaseAdmission: (toolCallId: string, operation: GatedTool) => consumePhaseAdmission(toolCallId, operation, store),
	});
	await handleJsonRpc({
		jsonrpc: "2.0", id: rpcId++, method: "initialize",
		params: { protocolVersion: "2025-06-18", clientInfo: { name: "claude-code", version: "2.1.236" }, capabilities: { elicitation: {} } },
	}, mcp);
	const prompt = (text: string) => recordPhaseEntryPrompt({ hook_event_name: "UserPromptSubmit", prompt: text, ...base }, locations);
	if (enroll) {
		prompt(`/immune-brain:imm-run ${TASK}`);
		expect(phaseEntryGateHookOutput({ hook_event_name: "PreToolUse", tool_name: ENROLL, tool_input: {}, tool_use_id: "toolu_enroll", ...base }, locations)).toBeNull();
		const reply = await handleJsonRpc({
			jsonrpc: "2.0", id: rpcId++, method: "tools/call",
			params: { name: "enroll", arguments: { task_id: TASK }, _meta: { "claudecode/toolUseId": "toolu_enroll" } },
		}, mcp);
		expect(reply?.error).toBeUndefined();
		expect(readActiveClaimTaskId(cwd)).toBe(TASK);
	}
	return {
		cwd,
		locations,
		prompt,
		edit: (tool_name: string, tool_input: Record<string, unknown>) =>
			revisionOwnerHookOutput({ hook_event_name: "PreToolUse", tool_name, tool_input, ...base }, locations),
	};
}

function denial(output: string | null): string {
	expect(output).not.toBeNull();
	const decision = (JSON.parse(output!) as { hookSpecificOutput: { permissionDecision: string; permissionDecisionReason: string } }).hookSpecificOutput;
	expect(decision.permissionDecision).toBe("deny");
	return decision.permissionDecisionReason;
}

describe("revision-owner guard on Claude Code", () => {
	test("a plan entry denies a file edit inside the active scope with one recovery action", async () => {
		const s = await session(true);
		s.prompt("/immune-brain:imm-planner tighten the acceptance");
		for (const [tool, input] of [
			["Edit", { file_path: join(s.cwd, "src/mod/a.ts") }],
			["Write", { file_path: "src/mod/a.ts" }],
			["MultiEdit", { file_path: join(s.cwd, "src/mod/a.ts") }],
			["NotebookEdit", { notebook_path: join(s.cwd, "src/mod/a.ts") }],
		] as const) {
			const reason = denial(s.edit(tool, input));
			expect(reason).toStartWith("revision_owner_required: ");
			expect(reason).toEndWith(`; recovery: ${REVISION_OWNER_RECOVERY}`);
			expect(reason.split("recovery:")).toHaveLength(2);
		}
	});

	test("nothing is denied after a run entry, even following an earlier plan entry", async () => {
		const s = await session(true);
		s.prompt("/imm-planner x");
		expect(denial(s.edit("Edit", { file_path: "src/mod/a.ts" }))).toStartWith("revision_owner_required: ");
		s.prompt("/immune-brain:imm-run owner-task");
		expect(s.edit("Edit", { file_path: "src/mod/a.ts" })).toBeNull();
	});

	test("nothing is denied without an active claim", async () => {
		const s = await session(false);
		s.prompt("/imm-planner x");
		expect(s.edit("Edit", { file_path: "src/mod/a.ts" })).toBeNull();
	});

	test("nothing is denied for a path outside the scope", async () => {
		const s = await session(true);
		s.prompt("/imm-planner x");
		expect(s.edit("Edit", { file_path: "src/other.ts" })).toBeNull();
		expect(s.edit("Write", { file_path: join(s.cwd, "..", "elsewhere.ts") })).toBeNull();
	});

	test("planning sidecars under docs/plans and docs/specs stay editable", async () => {
		const s = await session(true);
		s.prompt("/imm-planner x");
		expect(s.edit("Edit", { file_path: `docs/plans/${TASK}.intent.json` })).toBeNull();
		expect(s.edit("Write", { file_path: `docs/specs/${TASK}.spec.md` })).toBeNull();
	});

	test("an unreadable or empty entry store denies nothing", async () => {
		const s = await session(true);
		s.prompt("/imm-planner x");
		expect(denial(s.edit("Edit", { file_path: "src/mod/a.ts" }))).toStartWith("revision_owner_required: ");
		s.locations.read = () => { throw new Error("EIO"); };
		expect(s.edit("Edit", { file_path: "src/mod/a.ts" })).toBeNull();
		const fresh = await session(true);
		rmSync(fresh.locations.root, { recursive: true, force: true });
		expect(fresh.edit("Edit", { file_path: "src/mod/a.ts" })).toBeNull();
	});

	test("a non-file tool is not intercepted", async () => {
		const s = await session(true);
		s.prompt("/imm-planner x");
		expect(s.edit("Bash", { command: "echo > src/mod/a.ts" })).toBeNull();
		expect(s.edit("Read", { file_path: "src/mod/a.ts" })).toBeNull();
	});
});

describe("revision-owner decision", () => {
	const scope = ["src/mod/a.ts", "src/pkg/**"];

	test("refuses only on a latest plan entry and a path inside the scope", () => {
		const plan = { run_live: false, plan_latest: true };
		expect(revisionOwnerRefusal(plan, scope, "src/mod/a.ts")?.reason_code).toBe("revision_owner_required");
		expect(revisionOwnerRefusal(plan, scope, "src/pkg/deep/x.ts")).not.toBeNull();
		expect(revisionOwnerRefusal(plan, scope, "src/mod/b.ts")).toBeNull();
		expect(revisionOwnerRefusal({ run_live: true, plan_latest: false }, scope, "src/mod/a.ts")).toBeNull();
		expect(revisionOwnerRefusal(NO_PHASE_ENTRY, scope, "src/mod/a.ts")).toBeNull();
		expect(revisionOwnerRefusal(null, scope, "src/mod/a.ts")).toBeNull();
		expect(revisionOwnerRefusal(plan, null, "src/mod/a.ts")).toBeNull();
	});
});
