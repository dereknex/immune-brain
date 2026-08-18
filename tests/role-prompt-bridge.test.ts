import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	buildLoopRoleDispatch,
	buildLoopRoleDelegationPacket,
	determineRequiredReviewGates,
	INTERNAL_ROLE_PROMPTS,
	loadRolePrompt,
	type InternalRole,
} from "../plugins/immune-brain/runtime/imm_core";
import { ROLE_PROMPT_FILES } from "../scripts/dist-sync-manifest";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ROLES: InternalRole[] = ["qa", "code-review", "ui-review"];

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

	it("injects deterministic Parent context and preserves stable Review Gate identifiers", () => {
		const code = buildLoopRoleDelegationPacket({
			role: "code-review",
			context: {
				task_id: "task-5",
				target_id: "step-1",
				changed_files_signature: "sha256:files",
			},
		});
		const ui = buildLoopRoleDelegationPacket({
			role: "ui-review",
			context: {
				task_id: "task-5",
				target_id: "step-1",
				review_gate: "imm-ui-review",
				changed_files_signature: "sha256:files",
			},
		});
		const qa = buildLoopRoleDelegationPacket({
			role: "qa",
			context: { task_id: "task-5", target_id: "step-1" },
		});

		expect(code.review_gate).toBe("imm-code-review");
		expect(ui.review_gate).toBe("imm-ui-review");
		expect(determineRequiredReviewGates(["src/change.ts"])).toContain(code.review_gate);
		expect(determineRequiredReviewGates(["styles/change.css"])).toContain(ui.review_gate);
		expect(qa.review_gate).toBeUndefined();
		expect(code.prompt).toContain('"task_id": "task-5"');
		expect(code.prompt).toContain("tool_policy: no tools");
		expect(code.prompt).toContain("do not discover or load Pi Skills");
		expect(code.prompt_digest).toMatch(/^sha256:[0-9a-f]{64}$/);
	});

	it("rejects a Review packet with a mismatched stable gate", () => {
		expect(() =>
			buildLoopRoleDelegationPacket({
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
			expect(dispatch.call.isolation).toBe("worktree");
		}
	});
	it("ships the bridge source and packaged prompts", () => {
		const pkg = JSON.parse(read("package.json")) as { files: string[] };
		expect(pkg.files).toContain("plugins/immune-brain/runtime/role_prompt_bridge.ts");
		expect(pkg.files).toContain("plugins/immune-brain/runtime/loop_contract.ts");
		expect(pkg.files).toContain("plugins/immune-brain/runtime/prompts");
		expect(pkg.files).toContain("plugins/immune-brain/dist");
	});
	it("keeps Loop role dispatch on the internal bridge while retaining shims", () => {
		for (const path of [
			"plugins/immune-brain/skills/imm-loop/SKILL.md",
			"plugins/immune-brain/dist/imm-loop.md",
		]) {
			const content = read(path);
			expect(content).toContain("buildLoopRoleDispatch");
			expect(content).toMatch(/public\s+Skills\s+remain available as rollback shims/);
			expect(content).not.toContain("dispatch an isolated read-only `imm-qa`");
		}
	});
	it("keeps the public Skill shims available during the additive migration", () => {
		for (const role of ["imm-qa", "imm-code-review", "imm-ui-review"]) {
			expect(read(`plugins/immune-brain/skills/${role}/SKILL.md`)).toContain(
				"dist/",
			);
		}
	});
});
