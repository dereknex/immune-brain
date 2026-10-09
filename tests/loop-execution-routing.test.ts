import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	buildLoopAction,
	buildLoopRoleDispatch,
	resolveLoopRoute,
} from "../plugins/immune-brain/runtime/loop_contract";
import {
	INTERNAL_ROLE_PROMPTS,
	type InternalRole,
} from "../plugins/immune-brain/runtime/role_prompt_bridge";
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
			"arch-explorer.md",
			"advisory-reviewer.md",
			"compounder.md",
			"lane-steward.md",
		]);
		for (const role of REPAIR_ROLES) {
			const source = read(`plugins/immune-brain/runtime/prompts/${role}.md`);
			const packaged = read(`plugins/immune-brain/dist/role-prompts/${role}.md`);
			expect(packaged).toBe(source);
			expect(INTERNAL_ROLE_PROMPTS[role].file).toBe(`${role}.md`);
		}
	});

	it("injects Executor guidance into the current Parent context", () => {
		const action = buildLoopAction({
			ownership: "plan",
			target: "step",
			context: {
				task_id: "task-6",
				target_id: "step-1",
				active_step: { number: 1, scope: ["src/a.ts"], verification: ["bun test"] },
			},
		});
		expect(action.next).toBe("executor");
		if (action.next !== "executor") throw new Error("expected executor action");
		expect(action.context.authority).toBe("executor");
		expect(action.context.tool_policy).toBe("workspace tools");
		expect(action.context.prompt).toContain("enrolled TaskIntent acceptance");
		expect(action.context.prompt).toContain("scope expansion");
		const guidance = action.context.prompt.replace(/\s+/g, " ");
		for (const requirement of [
			"one compact row per acceptance",
			"Entry and consumers",
			"Positive / negative / boundary controls",
			"Command, outcome and input",
			"Finding coverage",
			"every affected caller's await, cancellation and error propagation",
			"Derive rejection controls from a successful state",
			"assert the intended rejection reason",
			"whether each check consumed worktree or delivery bytes",
			"all known trigger classes and their controls",
		]) expect(guidance).toContain(requirement);
		expect(action.context.prompt).not.toContain("skills/");
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
		const codeReview = buildLoopRoleDispatch({
			role: "code-review",
			context: { task_id: "task-6", focus_delta: { specific_changes: ["src/a.ts"] } },
		});
		const advisoryReview = buildLoopRoleDispatch({
			role: "advisory-reviewer",
			context: { task_id: "task-6", lens: "API compatibility", focus_delta: { specific_changes: ["src/a.ts"] } },
		});
		expect(testFix.packet.tool_policy).toBe("delegated test files");
		expect(testFix.call.prompt).toContain("tests/a.test.ts");
		expect(testFix.call.prompt).toContain("only the delegated test files");
		expect(prFix.packet.authority).toBe("pr-repair");
		expect(prFix.call.prompt).toContain("plan-6");
		expect(prFix.call.prompt).toContain("CI");
		expect(prFix.call.prompt).toContain("current worktree");
		expect(prFix.call.prompt).not.toContain("branched workspaces");
		expect(codeReview.call.subagent_type).toBe("Review");
		expect(advisoryReview.call.subagent_type).toBe("general-purpose");
		expect(read("plugins/immune-brain/runtime/prompts/code-review.md")).toContain("review_manifest/v5");
		expect(read("plugins/immune-brain/dist/role-prompts/code-review.md")).toBe(read("plugins/immune-brain/runtime/prompts/code-review.md"));
		for (const dispatch of [testFix, prFix, codeReview, advisoryReview]) {
			expect(dispatch.call.run_in_background).toBe(false);
			expect(dispatch.call.isolated).toBe(true);
			expect(dispatch.call).not.toHaveProperty("isolation");
		}
	});

	it("keeps Kernel and non-Kernel work under Loop with explicit next authorities", () => {
		expect(resolveLoopRoute({ ownership: "plan", target: "step" })).toEqual({
		entry: "imm-run",
		next: "executor",
	});
		expect(resolveLoopRoute({ ownership: "plan", target: "test-repair" })).toEqual({
		entry: "imm-run",
		next: "test-fixer",
	});
		expect(resolveLoopRoute({ ownership: "plan", target: "pr-repair" })).toEqual({
		entry: "imm-run",
		next: "pr-fix",
	});
		expect(resolveLoopRoute({ ownership: "kernel", target: "step" })).toEqual({
		entry: "imm-run",
		next: "imm_kernel_canary",
	});
		expect(resolveLoopRoute({ ownership: "kernel", target: "test-repair" })).toEqual({
		entry: "imm-run",
		next: "imm_kernel_canary",
	});
		expect(resolveLoopRoute({ ownership: "plan", target: "step", scope_expansion: true })).toEqual({
			entry: "imm-run",
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
			entry: "imm-run",
			next: "imm_kernel_canary",
			tool: { name: "imm_kernel_canary", operation: "advance_assurance" },
		});
	});

	it("documents internal execution routing with no public role shims", () => {
		const loop = read("plugins/immune-brain/dist/imm-run.md");
		// Routing and Kernel ownership are stated as obligations: the packaged
		// contract is shared by both Hosts, so it never names one Host's tools.
		expect(loop.replace(/\s+/g, " ")).toContain("role-boundary route");
		expect(loop).toContain("role-prompts/executor.md#delivery-evidence");
		expect(loop.replace(/\s+/g, " ")).toContain("update affected rows after repair");
		expect(loop).not.toContain("buildLoopRoleContext");
		expect(loop).toContain("test-fixer");
		expect(loop).toContain("pr-fix");
		expect(loop).toContain("Kernel ownership");
		expect(loop).toContain("Scope expansion returns to Planner's Enrolled Intent Revision route");
		expect(loop.replace(/\s+/g, " ")).toContain("the current Loop submits it through Kernel revision authority");
		expect(loop).not.toContain("route it through `imm-canary-work`");
		for (const path of [
			"plugins/immune-brain/dist/role-prompts/executor.md",
			"plugins/immune-brain/dist/role-prompts/test-fixer.md",
			"plugins/immune-brain/dist/role-prompts/pr-fix.md",
		]) {
			expect(read(path)).toContain("Internal role");
		}
	});
});

describe("lane-steward routing", () => {
	const provision = {
		task_id: "pbl-child",
		action: "provision",
		lane_branch: "imm-lane/pbl/pbl-child",
		base_head: "0123456789abcdef0123456789abcdef01234567",
		executor_hosts: ["claude-code", "pi"],
	};

	it("routes lane supply to the lane-steward role only under Loop ownership", () => {
		expect(resolveLoopRoute({ ownership: "loop", target: "lane-supply" })).toEqual({
			entry: "imm-run",
			next: "lane-steward",
		});
		for (const ownership of ["plan", "kernel", "brainstorm", "planner"] as const) {
			expect(() => resolveLoopRoute({ ownership, target: "lane-supply" })).toThrow(
				"Lane supply routing requires Loop ownership",
			);
		}
	});

	it("dispatches a provision and a release handoff to a general-purpose child with no Kernel authority", () => {
		for (const context of [provision, { task_id: "pbl-child", action: "release", lane_branch: provision.lane_branch }]) {
			const action = buildLoopAction({ ownership: "loop", target: "lane-supply", context });
			if (action.next !== "lane-steward") throw new Error("expected a lane-steward action");
			expect(action.dispatch.packet.role).toBe("lane-steward");
			expect(action.dispatch.packet.authority).toBe("lane-provision");
			expect(action.dispatch.call.subagent_type).toBe("general-purpose");
			expect(action.dispatch.call.isolated).toBe(true);
			expect(action.dispatch.call.inherit_context).toBe(false);
			expect(action.dispatch.call.prompt).toContain("Internal role: lane-steward");
		}
	});

	it("refuses a provision that offers a Host outside the allowlist, before a prompt is built", () => {
		for (const executor_hosts of [["claude-code", "other-host"], [], undefined, "pi"]) {
			expect(() =>
				buildLoopAction({
					ownership: "loop",
					target: "lane-supply",
					context: { ...provision, executor_hosts },
				}),
			).toThrow("lane-steward provision offers only claude-code, pi");
		}
	});

	it("refuses a handoff without a Lane branch, a base, or a known action", () => {
		const base = { ownership: "loop", target: "lane-supply" } as const;
		expect(() => buildLoopAction({ ...base, context: { ...provision, lane_branch: "" } })).toThrow("lane_branch");
		expect(() => buildLoopAction({ ...base, context: { ...provision, base_head: undefined } })).toThrow("base_head");
		expect(() => buildLoopAction({ ...base, context: { ...provision, action: "create" } })).toThrow(
			"action provision or release",
		);
	});

	it("keeps the role prompt, the runtime and the imm-run contract free of any workspace tool", () => {
		for (const path of [
			"plugins/immune-brain/runtime/prompts/lane-steward.md",
			"plugins/immune-brain/dist/role-prompts/lane-steward.md",
			"plugins/immune-brain/runtime/loop_contract.ts",
			"plugins/immune-brain/runtime/unattended/batch_lanes.ts",
			"plugins/immune-brain/runtime/unattended/batch_integration.ts",
			"plugins/immune-brain/dist/imm-run.md",
		]) {
			const source = read(path);
			expect({ path, herdr: /HERDR/i.test(source) }).toEqual({ path, herdr: false });
		}
		const prompt = read("plugins/immune-brain/runtime/prompts/lane-steward.md");
		for (const assumed of ["npm ", "pnpm", "yarn", "pip ", "cargo", "bundle install"]) {
			expect({ assumed, found: prompt.includes(assumed) }).toEqual({ assumed, found: false });
		}
		expect(prompt).toContain("cannot supply");
	});

	it("adds no public skill for the role", () => {
		expect(INTERNAL_ROLE_PROMPTS["lane-steward"].file).toBe("lane-steward.md");
		expect(existsSync(resolve(ROOT, "plugins/immune-brain/skills/lane-steward"))).toBe(false);
		expect(existsSync(resolve(ROOT, "plugins/immune-brain/skills/imm-lane-steward"))).toBe(false);
	});
});
