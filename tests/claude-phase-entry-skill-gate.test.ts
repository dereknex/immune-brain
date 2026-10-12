import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { canonicalIntentHash, parseTaskIntentV1 } from "../plugins/immune-brain/runtime/kernel/intent";
import { seedKernelRunForTest } from "./fixtures/mutation-authority-test-seam";
import { phaseEntryGateHookOutput, recordPhaseEntryPrompt, type PhaseEntryLocations } from "../plugins/immune-brain/runtime/claude/lane_guard";

function session() {
	const root = mkdtempSync(join(tmpdir(), "imm-skill-gate-"));
	const cwd = join(root, "workspace");
	const home = join(root, "home");
	mkdirSync(join(home, ".claude", "commands"), { recursive: true });
	mkdirSync(cwd, { recursive: true });
	writeFileSync(join(home, ".claude", "commands", "planner.md"), "Plan using the `imm-planner` skill.\n");
	writeFileSync(join(home, ".claude", "commands", "loop.md"), "Execute using the `imm-loop` skill.\n");
	const base = { session_id: "skill-gate-session", cwd };
	const locations: PhaseEntryLocations = { root, home };
	return {
		cwd,
		home,
		locations,
		prompt: (prompt: string) => recordPhaseEntryPrompt({ hook_event_name: "UserPromptSubmit", prompt, ...base }, locations),
		skill: (skill: string) => phaseEntryGateHookOutput({ hook_event_name: "PreToolUse", tool_name: "Skill", tool_input: { skill }, tool_use_id: "toolu_skill", ...base }, locations),
		tool: (tool_name: string, tool_input: Record<string, unknown> = {}) =>
			phaseEntryGateHookOutput({ hook_event_name: "PreToolUse", tool_name, tool_input, tool_use_id: "toolu_other", ...base }, locations),
	};
}

function denial(output: string | null): string {
	expect(output).not.toBeNull();
	const parsed = JSON.parse(output!) as { hookSpecificOutput: { hookEventName: string; permissionDecision: string; permissionDecisionReason: string } };
	expect(parsed.hookSpecificOutput.hookEventName).toBe("PreToolUse");
	expect(parsed.hookSpecificOutput.permissionDecision).toBe("deny");
	return parsed.hookSpecificOutput.permissionDecisionReason;
}

/** Seed one committed active run through the Kernel store, so the workspace has a real claim. */
function claimWorkspace(cwd: string, taskId: string): void {
	const intent = {
		contract: "assurance_kernel/task_intent/v1",
		task_id: taskId,
		owner: "user",
		goal: `goal for ${taskId}`,
		acceptance: [{ id: "acc-1", assertion: `assertion for ${taskId}`, verification: `bun test tests/${taskId}.test.ts` }],
		scope_hint: ["docs/plans", `docs/specs/${taskId}.spec.md`, `docs/specs/archive/${taskId}.spec.md`],
		risk: "routine",
		revision: 1,
	};
	const intentPath = join(cwd, "docs", "plans", `${taskId}.intent.json`);
	mkdirSync(dirname(intentPath), { recursive: true });
	writeFileSync(intentPath, `${JSON.stringify(intent, null, 2)}\n`);
	seedKernelRunForTest(cwd, {
		task_id: taskId,
		record: {
			contract: "assurance_kernel/task_record/v4",
			task_id: taskId,
			intent_snapshot: intent,
			intent_ref: { path: `docs/plans/${taskId}.intent.json`, content_hash: canonicalIntentHash(parseTaskIntentV1(intent)) },
			lifecycle: "active",
			artifact_state: "active",
			baseline: `sha256:${"a".repeat(64)}`,
			git_base_head: "a".repeat(40),
			attestations: [],
			findings: [],
			history: [],
		},
	});
}

describe("Claude phase entry Skill gate", () => {
	test("a Skill call is allowed when the latest literal prompt entered that phase", () => {
		const s = session();
		expect(s.prompt("/planner add a gate")).toBe(true);
		expect(s.skill("immune-brain:imm-planner")).toBeNull();
		expect(s.skill("imm-brainstorm")).toBeNull();
		expect(s.prompt("/loop task-a")).toBe(true);
		expect(s.skill("immune-brain:imm-run")).toBeNull();
	});

	test("model self-entry is denied with phase_entry_required and one recovery action", () => {
		const s = session();
		for (const skill of ["immune-brain:imm-planner", "imm-planner", "immune-brain:imm-brainstorm", "immune-brain:imm-run"]) {
			const reason = denial(s.skill(skill));
			expect(reason).toStartWith("phase_entry_required: ");
			expect(reason).toEndWith("; recovery: ask the user to enter the Skill themselves in the current Host");
			expect(reason.split("recovery:")).toHaveLength(2);
		}
	});

	test("a padded Skill name is still gated", () => {
		const s = session();
		for (const skill of [" imm-run", "imm-run ", "\timmune-brain:imm-planner\n", " /imm-brainstorm "])
			expect(denial(s.skill(skill))).toStartWith("phase_entry_required: ");
		s.prompt("/loop task-a");
		expect(s.skill(" immune-brain:imm-run ")).toBeNull();
	});

	test("a prompt the store could not record drops the earlier entry instead of leaving it live", () => {
		const s = session();
		expect(s.prompt("/loop task-a")).toBe(true);
		expect(s.skill("immune-brain:imm-run")).toBeNull();
		// The plan entry that would revoke the run entry fails to append.
		s.locations.append = () => false;
		expect(s.prompt("/planner revise it")).toBe(false);
		delete s.locations.append;
		expect(denial(s.skill("immune-brain:imm-run"))).toStartWith("phase_entry_required: ");
		expect(denial(s.skill("immune-brain:imm-planner"))).toStartWith("phase_entry_required: ");
		expect(denial(s.tool("mcp__plugin_immune-brain_immune-brain__enroll"))).toStartWith("run_entry_required: ");
		// A fresh literal entry recovers the session.
		expect(s.prompt("/loop task-a")).toBe(true);
		expect(s.skill("immune-brain:imm-run")).toBeNull();
	});

	test("a store read that throws denies instead of letting the call through", () => {
		const s = session();
		expect(s.prompt("/loop task-a")).toBe(true);
		s.locations.read = () => { throw new Error("EIO"); };
		expect(denial(s.skill("immune-brain:imm-run"))).toStartWith("phase_entry_required: ");
		expect(denial(s.tool("mcp__plugin_immune-brain_immune-brain__enroll"))).toStartWith("run_entry_required: ");
		expect(s.skill("frontend-design")).toBeNull();
		delete s.locations.read;
		expect(s.skill("immune-brain:imm-run")).toBeNull();
	});

	test("an admission write that throws denies the tool call", () => {
		const s = session();
		expect(s.prompt("/loop task-a")).toBe(true);
		s.locations.append = () => { throw new Error("EIO"); };
		expect(denial(s.tool("mcp__plugin_immune-brain_immune-brain__enroll"))).toStartWith("run_entry_required: ");
	});

	test("a symlinked alias is bounded by its target, not by the link", () => {
		const s = session();
		const commands = join(s.home, ".claude", "commands");
		writeFileSync(join(s.home, "big.md"), `Execute using the \`imm-run\` skill.\n${"x".repeat(64 * 1024)}`);
		symlinkSync(join(s.home, "big.md"), join(commands, "big.md"));
		writeFileSync(join(s.home, "small.md"), "Execute using the `imm-run` skill.\n");
		symlinkSync(join(s.home, "small.md"), join(commands, "small.md"));
		s.prompt("/big task-a");
		expect(denial(s.skill("immune-brain:imm-run"))).toStartWith("phase_entry_required: ");
		s.prompt("/small task-a");
		expect(s.skill("immune-brain:imm-run")).toBeNull();
	});

	test("a design confirmation after the entry prompt no longer admits the Skill", () => {
		const s = session();
		s.prompt("/planner add a gate");
		s.prompt("confirm");
		expect(denial(s.skill("immune-brain:imm-planner"))).toContain("phase_entry_required");
		s.prompt("/loop task-a");
		s.prompt("continue");
		expect(denial(s.skill("immune-brain:imm-run"))).toContain("phase_entry_required");
	});

	test("a plan entry does not admit imm-run, and a mention is not an entry", () => {
		const s = session();
		s.prompt("/planner");
		expect(denial(s.skill("immune-brain:imm-run"))).toContain("phase_entry_required");
		s.prompt("now use the imm-run skill and /loop it");
		expect(denial(s.skill("immune-brain:imm-run"))).toContain("phase_entry_required");
	});

	test("the revision route admits the Planner inside a live run with an active claim only", () => {
		const s = session();
		s.prompt("/loop task-a");
		s.prompt("the scope must grow");
		expect(denial(s.skill("immune-brain:imm-planner"))).toContain("phase_entry_required");
		execFileSync("git", ["init", "-q"], { cwd: s.cwd });
		claimWorkspace(s.cwd, "task-a");
		expect(s.skill("immune-brain:imm-planner")).toBeNull();
		expect(denial(s.skill("immune-brain:imm-brainstorm"))).toContain("phase_entry_required");
	});

	test("every other Skill and tool is left untouched", () => {
		const s = session();
		expect(s.skill("immune-brain:imm-retro")).toBeNull();
		expect(s.skill("planner")).toBeNull();
		expect(s.skill("code-review")).toBeNull();
		expect(s.tool("Skill", {})).toBeNull();
		expect(s.tool("Bash", { command: "echo imm-run" })).toBeNull();
		expect(s.tool("mcp__plugin_immune-brain_immune-brain__status", { task_id: "t" })).toBeNull();
		expect(s.tool("mcp__plugin_immune-brain_immune-brain__advance_assurance", { task_id: "t" })).toBeNull();
		expect(s.tool("mcp__other__enroll", { task_id: "t" })).toBeNull();
		expect(phaseEntryGateHookOutput({ hook_event_name: "PostToolUse", tool_name: "Skill", tool_input: { skill: "imm-run" }, session_id: "x" })).toBeNull();
	});
});
