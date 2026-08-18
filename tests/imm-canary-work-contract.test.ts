// Pi-only Kernel routing Skill contract.

import { describe, expect, test } from "bun:test";
import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(__dirname, "..");
const SKILLS = join(ROOT, "plugins/immune-brain/skills");

function read(rel: string): string {
	return readFileSync(join(ROOT, rel), "utf8");
}

describe("imm-canary-work skill contract", () => {
	test("skill entry and packaged copy describe the foreground assurance route", () => {
		const entry = read("plugins/immune-brain/skills/imm-canary-work/SKILL.md");
		const dist = read("plugins/immune-brain/dist/imm-canary-work.md");
		for (const text of [entry, dist]) {
			expect(text).toContain("imm_kernel_canary");
			expect(text).toContain("advance_assurance");
			expect(text).toContain("submit_review");
			expect(text).toContain("request_authorization");
			expect(text).toContain("run_in_background: false");
			expect(text).toContain("tool_call");
			expect(text).toContain("tool_result");
			expect(text).toContain("tool_execution_end");
			expect(text).not.toContain("get_subagent_result");
			expect(text).not.toContain("cancel_assurance");
			expect(text).not.toContain("followUp");
		}
		expect(entry).toContain("Load");
		expect(dist).toContain("record-user-approval");
		expect(dist).toContain("/imm-canary-authorize");
	});

	test("enrollment contracts require isolated descriptor rehearsal and one explicit waiver route", () => {
		const guide = read("plugins/immune-brain/USER_GUIDE.md");
		const kernelCommand = read("plugins/immune-brain/runtime/commands/kernel.ts");
		const defaultRoute = read("plugins/immune-brain/.pi-extension/imm-canary-new.ts");
		const waiverRoute = read("plugins/immune-brain/.pi-extension/imm-canary-enroll.ts");
		expect(guide).toContain("foreground");
		expect(guide).toContain("descriptor-rehearsal/v1:waived:<digest>");
		expect(guide).toContain("frozen `index_digest`");
		expect(guide).toContain("scope/index snapshot integrity");
		expect(kernelCommand).toContain('status: enrollmentReady ? "pending_tui_enrollment"');
		expect(kernelCommand).toContain('waiver_route: "explicit_tui_waiver"');
		expect(kernelCommand).toContain('snapshot_binding: "frozen_git_index_digest"');
		expect(kernelCommand).toContain('scope_drift: "non_waivable"');
		expect(kernelCommand).toContain('timeout_budget: "isolated_copy_setup_and_execution"');
		expect(kernelCommand).toContain('setup_timeout: "non_waivable_close_settled"');
		expect(kernelCommand).toContain('cancellation: "non_waivable_close_settled"');
		expect(kernelCommand).toContain('output_limit: "non_waivable_close_settled"');
		expect(kernelCommand).toContain('setup_failure: "non_waivable"');
		expect(kernelCommand).toContain('live_integrity_drift: "abort_all_non_waivable_close_settled"');
		expect(defaultRoute).toContain('launchEnrollmentRequest(pi, "new"');
		expect(defaultRoute).not.toContain("runDescriptorRehearsal");
		expect(waiverRoute).toContain('name: "imm_canary_enrollment"');
		expect(waiverRoute).toContain('const route = action === "new" ? "default" : "explicit_waiver"');
		expect(waiverRoute).toContain("assertDescriptorRehearsalSnapshot");
		expect(waiverRoute).toContain("onUpdate");
		expect(waiverRoute).not.toContain("EnrollmentJobCoordinator");
		expect(waiverRoute).not.toContain("setWidget(");
		expect(waiverRoute).not.toContain("setStatus(");
	});

	test("skill is registered in both registry copies", () => {
		for (const rel of [
			"plugins/immune-brain/skills/registry.yaml",
			"plugins/immune-brain/dist/registry.yaml",
		]) {
			const registry = read(rel);
			const block = registry.split("  - name: imm-canary-work")[1]?.split("\n  - name:")[0] ?? "";
			expect(block).toContain("path: skills/imm-canary-work/SKILL.md");
			expect(block).toContain("role: coordinate");
		}
	});

	test("registry copies are byte-identical", () => {
		expect(read("plugins/immune-brain/skills/registry.yaml")).toBe(
			read("plugins/immune-brain/dist/registry.yaml"),
		);
	});

	test("imm-work and imm-loop carry the Kernel routing clause", () => {
		for (const name of ["imm-work", "imm-loop"]) {
			const entry = read(`plugins/immune-brain/skills/${name}/SKILL.md`);
			const dist = read(`plugins/immune-brain/dist/${name}.md`);
			expect(entry).toMatch(/imm-canary-work|Kernel projection/i);
			expect(dist).toMatch(/Kernel Canary Routing/i);
			expect(dist).toMatch(/task tombstone|terminal/i);
			expect(dist).toMatch(/fail(s)?\s+closed/i);
		}
	});

	test("every SKILL.md directory is registered", () => {
		const registry = read("plugins/immune-brain/skills/registry.yaml");
		const names = [...registry.matchAll(/^\s{2}-\s+name:\s*(.+?)\s*$/gm)].map((m) => m[1]);
		const { readdirSync } = require("node:fs") as typeof import("node:fs");
		const dirs = readdirSync(SKILLS, { withFileTypes: true })
			.filter((d) => d.isDirectory() && existsSync(join(SKILLS, d.name, "SKILL.md")))
			.map((d) => d.name);
		for (const dir of dirs) expect(names).toContain(dir);
	});
});
