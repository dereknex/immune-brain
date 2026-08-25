import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	buildLoopAction,
	buildLoopRoleDispatch,
	normalizeAdvisoryReviewerOutput,
	normalizeArchitectureExplorerOutput,
	resolveLoopRoute,
} from "../plugins/immune-brain/runtime/loop_contract";
import {
	INTERNAL_ROLE_PROMPTS,
	loadRolePrompt,
	type InternalRole,
} from "../plugins/immune-brain/runtime/role_prompt_bridge";
import { ROLE_PROMPT_FILES } from "../scripts/dist-sync-manifest";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ROLES: InternalRole[] = [
	"qa",
	"code-review",
	"ui-review",
	"executor",
	"test-fixer",
	"pr-fix",
	"arch-explorer",
	"advisory-reviewer",
	"compounder",
];

function read(path: string): string {
	return readFileSync(resolve(ROOT, path), "utf8");
}

describe("internal role-prompt bridge", () => {
	it("keeps canonical and packaged prompt bytes identical for every Loop role", () => {
		expect([...ROLE_PROMPT_FILES]).toEqual(ROLES.map((role) => `${role}.md`));
		for (const role of ROLES) {
			const source = read(`plugins/immune-brain/runtime/prompts/${role}.md`);
			const packaged = read(`plugins/immune-brain/dist/role-prompts/${role}.md`);
			expect(packaged).toBe(source);
			expect(INTERNAL_ROLE_PROMPTS[role].file).toBe(`${role}.md`);
		}
	});

	it("loads a packaged role contract without discovering a public Skill", () => {
		for (const role of ROLES) {
			const prompt = loadRolePrompt(role);
			expect(prompt.toLowerCase()).toContain(`internal role: ${role}`);
			expect(prompt).not.toContain("skills/");
		}
	});

	it("routes exploration and advisory review through the internal role contract", () => {
		expect(
			resolveLoopRoute({
				ownership: "brainstorm",
				target: "architecture-exploration",
			}),
		).toEqual({ entry: "imm-loop", next: "arch-explorer" });
		const archAction = buildLoopAction({
			ownership: "brainstorm",
			target: "architecture-exploration",
			context: { task_id: "task-7", focus_delta: { directories: ["plugins/"] } },
		});
		expect(archAction.next).toBe("arch-explorer");
		if (archAction.next === "arch-explorer") {
			expect(archAction.dispatch.packet.tool_policy).toBe("read-only tools");
		}
		const architectureEvidence = normalizeArchitectureExplorerOutput({
			candidates: [{ path: "runtime/loop_contract.ts" }],
			evidence: ["The bridge is the routing boundary."],
			risks: [],
			open_questions: [],
		});
		expect(architectureEvidence.valid).toBe(true);
		expect(normalizeArchitectureExplorerOutput({ candidates: [], evidence: [], risks: [], open_questions: [], state_write: true }).valid).toBe(false);

		const advisoryAction = buildLoopAction({
			ownership: "planner",
			target: "advisory-review",
			context: { task_id: "task-7", lens: "reliability" },
		});
		expect(advisoryAction.next).toBe("advisory-reviewer");
		if (advisoryAction.next === "advisory-reviewer") {
			expect(advisoryAction.dispatch.packet.tool_policy).toBe("no tools");
			expect(advisoryAction.dispatch.packet.prompt).toContain('"lens": "reliability"');
		}
		const advisoryEvidence = normalizeAdvisoryReviewerOutput({
			recommendations: [],
			disagreements: [],
			open_questions: ["Should this be a separate Plan?"],
			blockers: [],
		});
		expect(advisoryEvidence.valid).toBe(true);
		expect(() =>
			buildLoopAction({
				ownership: "planner",
				target: "advisory-review",
				context: { task_id: "task-7" },
			}),
		).toThrow("explicit lens");
	});

	it("dispatches Compounder only for closed Steps with reusable Learning evidence", () => {
		const context = {
			task_id: "task-7",
			workflow_phase: "complete" as const,
			assurance_complete: true,
			required_reviews_complete: true,
			closed_steps: [
				{
					step_id: "step-1",
					state: "closed",
					learning_evidence: {
						reusable: true,
						summary: "The role bridge keeps package prompts deterministic.",
						evidence_ref: "test:role-prompt-bridge",
					},
				},
			],
		};
		const action = buildLoopAction({
			ownership: "loop",
			target: "compounder",
			context,
		});
		expect(action.next).toBe("compounder");
		if (action.next === "compounder") {
			expect(action.dispatch.packet.role).toBe("compounder");
		}

		expect(
			buildLoopAction({
				ownership: "loop",
				target: "compounder",
				context: {
					task_id: "routine-no-learning",
					workflow_phase: "complete",
					assurance_complete: true,
					required_reviews_complete: true,
					closed_steps: [],
				},
			}),
		).toEqual({
			entry: "imm-loop",
			next: "none",
			reason: "no_reusable_learning",
		});

		expect(
			buildLoopAction({
				ownership: "loop",
				target: "compounder",
				context: {
					task_id: "still-working",
					workflow_phase: "working",
					assurance_complete: true,
					required_reviews_complete: true,
					closed_steps: context.closed_steps,
				},
			}),
		).toEqual({
			entry: "imm-loop",
			next: "none",
			reason: "no_reusable_learning",
		});
	});

	it("injects deterministic Parent context and preserves stable Review Gate identifiers", () => {
		const code = buildLoopRoleDispatch({
			role: "code-review",
			context: {
				task_id: "task-5",
				target_id: "step-1",
				changed_files_signature: "sha256:files",
			},
		}).packet;
		const ui = buildLoopRoleDispatch({
			role: "ui-review",
			context: {
				task_id: "task-5",
				target_id: "step-1",
				review_gate: "imm-ui-review",
				changed_files_signature: "sha256:files",
			},
		}).packet;
		const qa = buildLoopRoleDispatch({
			role: "qa",
			context: { task_id: "task-5", target_id: "step-1" },
		}).packet;

		expect(code.review_gate).toBe("imm-code-review");
		expect(ui.review_gate).toBe("imm-ui-review");
		expect(qa.review_gate).toBeUndefined();
		expect(code.prompt).toContain('"task_id": "task-5"');
		expect(code.tool_policy).toBe("read-only tools");
		expect(code.prompt).toContain("tool_policy: read-only tools");
		expect(code.prompt).toContain("do not discover or load Pi Skills");
		expect(code.prompt_digest).toMatch(/^sha256:[0-9a-f]{64}$/);
	});

	it("rejects a Review packet with a mismatched stable gate", () => {
		expect(() =>
			buildLoopRoleDispatch({
				role: "code-review",
				context: { task_id: "task-5", review_gate: "imm-ui-review" },
			}),
		).toThrow("review gate imm-ui-review does not match code-review");
	});

	it("builds foreground Agent calls for every internal Loop role", () => {
		for (const role of ROLES) {
			const dispatch = buildLoopRoleDispatch({
				role,
				context: { task_id: "task-5", target_id: "step-1" },
			});
			expect(dispatch.call.prompt).toBe(dispatch.packet.prompt);
			expect(dispatch.call.run_in_background).toBe(false);
			expect(dispatch.call.inherit_context).toBe(false);
			expect(dispatch.call.isolated).toBe(true);
			expect(dispatch.call).not.toHaveProperty("isolation");
		}
	});
	it("supersedes the standalone explorer decision with the internal routing ADR", () => {
		const retired = read("docs/adr/0001-dedicated-architecture-explorer-skill.md");
		expect(retired).toContain("status: superseded");
		expect(retired).toContain("superseded_by: docs/adr/0003-internal-role-prompt-routing.md");
		const current = read("docs/adr/0003-internal-role-prompt-routing.md");
		expect(current).toContain("read-only `arch-explorer`");
		expect(current).toContain("reusable Learning");
	});

	it("ships the bridge source and packaged prompts", () => {
		const pkg = JSON.parse(read("package.json")) as { files: string[] };
		expect(pkg.files).toContain("plugins/immune-brain/runtime/role_prompt_bridge.ts");
		expect(pkg.files).toContain("plugins/immune-brain/runtime/loop_contract.ts");
		expect(pkg.files).toContain("plugins/immune-brain/runtime/prompts");
		expect(pkg.files).toContain("plugins/immune-brain/dist");
	});
	it("keeps Loop role dispatch on the internal bridge and the public surface closed", () => {
		for (const path of [
			"plugins/immune-brain/skills/imm-loop/SKILL.md",
			"plugins/immune-brain/dist/imm-loop.md",
		]) {
			const content = read(path);
			expect(content).toContain("imm_loop_action");
			expect(content).toContain("three-entry public Skill surface");
			expect(content).not.toMatch(/public\s+Skills\s+remain available as rollback shims/);
			expect(content).not.toContain("dispatch an isolated read-only `imm-qa`");
		}
	});
	it("loads internal role prompts without public Skill shims", () => {
		for (const role of [
			"qa",
			"code-review",
			"ui-review",
			"executor",
			"test-fixer",
			"pr-fix",
			"arch-explorer",
			"advisory-reviewer",
			"compounder",
		]) {
			expect(read(`plugins/immune-brain/runtime/prompts/${role}.md`)).toContain(
				"Internal role",
			);
			expect(existsSync(resolve(ROOT, `plugins/immune-brain/skills/imm-${role}/SKILL.md`))).toBe(false);
		}
	});
});
