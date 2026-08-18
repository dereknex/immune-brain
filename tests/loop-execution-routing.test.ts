import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	buildLoopAction,
	buildLoopRoleContext,
	buildLoopRoleDispatch,
	INTERNAL_ROLE_PROMPTS,
	resolveLoopRoute,
	type InternalRole,
} from "../plugins/immune-brain/runtime/imm_core";
import { ROLE_PROMPT_FILES } from "../scripts/dist-sync-manifest";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REPAIR_ROLES: InternalRole[] = ["executor", "test-fixer", "pr-fix"];

function read(path: string): string {
	return readFileSync(resolve(ROOT, path), "utf8");
}

describe("Loop execution and repair routing", () => {
	it("ships canonical and packaged prompts for every execution role", () => {
		expect([...ROLE_PROMPT_FILES]).toEqual([
			"qa.md",
			"code-review.md",
			"ui-review.md",
			"executor.md",
			"test-fixer.md",
			"pr-fix.md",
		]);
		for (const role of REPAIR_ROLES) {
			const source = read(`plugins/immune-brain/runtime/prompts/${role}.md`);
			const packaged = read(`plugins/immune-brain/dist/role-prompts/${role}.md`);
			expect(packaged).toBe(source);
			expect(INTERNAL_ROLE_PROMPTS[role].file).toBe(`${role}.md`);
		}
	});

	it("injects Executor guidance into the current Parent context", () => {
		const context = buildLoopRoleContext({
			role: "executor",
			context: {
				task_id: "task-6",
				target_id: "step-1",
				active_step: { number: 1, scope: ["src/a.ts"], verification: ["bun test"] },
			},
		});
		expect(context.authority).toBe("executor");
		expect(context.tool_policy).toBe("workspace tools");
		expect(context.prompt).toContain("active Step");
		expect(context.prompt).toContain("scope expansion");
		expect(context.prompt).not.toContain("skills/");
	});

	it("builds bounded internal Test Fixer and PR Fix dispatches", () => {
		const testFix = buildLoopRoleDispatch({
			role: "test-fixer",
			context: {
				task_id: "task-6",
				target_id: "step-1",
				focus_delta: { specific_changes: ["tests/a.test.ts"], verification_hint: "bun test tests/a.test.ts" },
			},
		});
		const prFix = buildLoopRoleDispatch({
			role: "pr-fix",
			context: {
				task_id: "task-6",
				plan_id: "plan-6",
				changed_files: ["src/a.ts"],
				verification: ["bun test"],
			},
		});
		expect(testFix.packet.tool_policy).toBe("delegated test files");
		expect(testFix.call.prompt).toContain("tests/a.test.ts");
		expect(testFix.call.prompt).toContain("only the delegated test files");
		expect(prFix.packet.authority).toBe("pr-repair");
		expect(prFix.call.prompt).toContain("plan-6");
		expect(prFix.call.prompt).toContain("CI");
		for (const dispatch of [testFix, prFix]) {
			expect(dispatch.call.run_in_background).toBe(false);
			expect(dispatch.call.isolation).toBe("worktree");
		}
	});

	it("keeps Kernel and non-Kernel work under Loop with explicit next authorities", () => {
		expect(resolveLoopRoute({ ownership: "plan", target: "step" })).toEqual({
		entry: "imm-loop",
		next: "executor",
	});
		expect(resolveLoopRoute({ ownership: "plan", target: "test-repair" })).toEqual({
		entry: "imm-loop",
		next: "test-fixer",
	});
		expect(resolveLoopRoute({ ownership: "plan", target: "pr-repair" })).toEqual({
		entry: "imm-loop",
		next: "pr-fix",
	});
		expect(resolveLoopRoute({ ownership: "kernel", target: "step" })).toEqual({
		entry: "imm-loop",
		next: "imm_kernel_canary",
	});
		expect(resolveLoopRoute({ ownership: "kernel", target: "test-repair" })).toEqual({
		entry: "imm-loop",
		next: "imm_kernel_canary",
	});
		expect(resolveLoopRoute({ ownership: "plan", target: "step", scope_expansion: true })).toEqual({
			entry: "imm-loop",
			next: "imm-planner",
		});

		const executorAction = buildLoopAction({
			ownership: "plan",
			target: "step",
			context: { task_id: "task-6", target_id: "step-1" },
		});
		expect(executorAction.next).toBe("executor");
		if (executorAction.next === "executor")
			expect(executorAction.context.role).toBe("executor");

		const testRepairAction = buildLoopAction({
			ownership: "plan",
			target: "test-repair",
			context: {
				task_id: "task-6",
				focus_delta: { specific_changes: ["tests/a.test.ts"] },
			},
		});
		expect(testRepairAction.next).toBe("test-fixer");
		if (testRepairAction.next === "test-fixer")
			expect(testRepairAction.dispatch.packet.role).toBe("test-fixer");

		const kernelAction = buildLoopAction({
			ownership: "kernel",
			target: "step",
			context: { task_id: "task-6" },
			kernel_operation: "advance_assurance",
		});
		expect(kernelAction).toEqual({
			entry: "imm-loop",
			next: "imm_kernel_canary",
			tool: { name: "imm_kernel_canary", operation: "advance_assurance" },
		});
	});

	it("documents internal execution routing while retaining compatibility shims", () => {
		const loop = read("plugins/immune-brain/dist/imm-loop.md");
		expect(loop).toContain("buildLoopAction");
		expect(loop).toContain("buildLoopRoleContext");
		expect(loop).toContain("test-fixer");
		expect(loop).toContain("pr-fix");
		expect(loop).toContain("imm_kernel_canary");
		expect(loop).toContain("Scope expansion always returns to `imm-planner`");
		expect(loop).not.toContain("route it through `imm-canary-work`");
		for (const path of [
			"plugins/immune-brain/skills/imm-executor/SKILL.md",
			"plugins/immune-brain/skills/test-fixer/SKILL.md",
			"plugins/immune-brain/skills/imm-pr-fix/SKILL.md",
		]) {
			expect(read(path)).toContain("dist/");
		}
	});
});
