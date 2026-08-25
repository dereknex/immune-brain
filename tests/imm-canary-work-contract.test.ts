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

	test("enrollment validates descriptors without executing them", () => {
		const guide = read("plugins/immune-brain/USER_GUIDE.md");
		const kernelCommand = read("plugins/immune-brain/runtime/commands/kernel.ts");
		const enrollment = read("plugins/immune-brain/.pi-extension/imm-canary-enroll.ts");
		expect(guide).toContain("只在后置 QA");
		expect(kernelCommand).toContain("parseVerificationDescriptor(item.verification)");
		expect(kernelCommand).not.toContain("descriptor_rehearsal");
		expect(enrollment).toContain('name: "imm_canary_enrollment"');
		expect(enrollment).not.toContain("runDescriptorRehearsal");
		expect(enrollment).not.toContain("checkout-index");
		expect(enrollment).not.toContain("setWidget(");
		expect(enrollment).not.toContain("setStatus(");
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
