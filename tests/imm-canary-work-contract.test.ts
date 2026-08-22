// Pi-only Kernel routing Skill contract.

import { describe, expect, test } from "bun:test";
import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(__dirname, "..");
const SKILLS = join(ROOT, "plugins/immune-brain/skills");

function read(rel: string): string {
	return readFileSync(join(ROOT, rel), "utf8");
}

describe("imm-loop Kernel routing contract", () => {
	test("public Loop entry and packaged copy describe the foreground assurance route", () => {
		const entry = read("plugins/immune-brain/skills/imm-loop/SKILL.md");
		const dist = read("plugins/immune-brain/dist/imm-loop.md");
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
		expect(dist).toContain("native TUI gate");
	});

	test("native authority operations bypass chat pre-confirmation", () => {
		const entry = read("plugins/immune-brain/skills/imm-loop/SKILL.md");
		const dist = read("plugins/immune-brain/dist/imm-loop.md");
		for (const text of [entry, dist]) {
			expect(text).toContain("request_authorization");
			expect(text).toContain("approve_breaking_intent_revision");
			expect(text).toContain("repair_authority_state");
			expect(text).toContain("chat pre-confirmation");
			expect(text).toContain("single authority decision");
		}

		const extension = read("plugins/immune-brain/.pi-extension/imm-canary-work.ts");
		for (const operation of [
			"request_authorization",
			"approve_breaking_intent_revision",
			"repair_authority_state",
		]) {
			expect(extension).toContain(operation);
		}
		expect(extension).toContain("do not ask for chat pre-confirmation");
		expect(extension).toContain("single native confirmation");
	});

	test("enrollment contracts require isolated descriptor rehearsal and one explicit waiver route", () => {
		const guide = read("plugins/immune-brain/USER_GUIDE.md");
		const kernelCommand = read("plugins/immune-brain/runtime/commands/kernel.ts");
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
		expect(waiverRoute).toContain('name: "imm_canary_enrollment"');
		expect(waiverRoute).toContain('const route = action === "new" ? "default" : "explicit_waiver"');
		expect(waiverRoute).toContain("assertDescriptorRehearsalSnapshot");
		expect(waiverRoute).toContain("onUpdate");
		expect(waiverRoute).not.toContain("EnrollmentJobCoordinator");
		expect(waiverRoute).not.toContain("setWidget(");
		expect(waiverRoute).not.toContain("setStatus(");
	});

	test("the public registry exposes Loop instead of the former canary Skill", () => {
		for (const rel of [
			"plugins/immune-brain/skills/registry.yaml",
			"plugins/immune-brain/dist/registry.yaml",
		]) {
			const registry = read(rel);
			expect(registry).toContain("path: skills/imm-loop/SKILL.md");
			expect(registry).toContain("role: coordinate");
			expect(registry).not.toContain("imm-canary-work");
		}
	});

	test("registry copies are byte-identical", () => {
		expect(read("plugins/immune-brain/skills/registry.yaml")).toBe(
			read("plugins/immune-brain/dist/registry.yaml"),
		);
	});

	test("public Loop carries the Kernel routing clause", () => {
		const entry = read("plugins/immune-brain/skills/imm-loop/SKILL.md");
		const dist = read("plugins/immune-brain/dist/imm-loop.md");
		expect(entry).toMatch(/imm-canary-work|Kernel projection/i);
		expect(dist).toMatch(/Kernel Canary Routing/i);
		expect(dist).toMatch(/task tombstone|terminal/i);
		expect(dist).toMatch(/fail(s)?\s+closed/i);
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
