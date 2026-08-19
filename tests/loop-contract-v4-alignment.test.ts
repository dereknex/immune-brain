import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");

function read(rel: string): string {
	return readFileSync(join(ROOT, rel), "utf8");
}

const KERNEL_SURFACE = [
	"imm_loop_action",
	"imm_kernel_canary",
	"advance_assurance",
	"submit_review",
	"request_authorization",
] as const;

describe("loop contract v4 alignment", () => {
	test("packaged loop contract instructs the Kernel path and not the retired autowork playbook", () => {
		const dist = read("plugins/immune-brain/dist/imm-loop.md");
		for (const token of KERNEL_SURFACE) {
			expect(dist).toContain(token);
		}
		expect(dist).not.toContain("imm-autowork");
		expect(dist).not.toMatch(/State Ledger authority/i);
		expect(dist).not.toMatch(/Run `imm-autowork --json`/);
		expect(dist).not.toMatch(/Consume `imm-autowork --json`/);
	});

	test("plugin README no longer both consumes and retires imm-autowork", () => {
		const readme = read("plugins/immune-brain/README.md");
		expect(readme).not.toMatch(/imm-loop` consumes `imm-autowork/);
		expect(readme).toContain("bin/imm-autowork");
		expect(readme).toMatch(/Retired after v4 storage retirement/);
	});

	test("public Loop skill and packaged copy share the Kernel surface", () => {
		const skill = read("plugins/immune-brain/skills/imm-loop/SKILL.md");
		const dist = read("plugins/immune-brain/dist/imm-loop.md");
		for (const token of KERNEL_SURFACE) {
			expect(skill).toContain(token);
			expect(dist).toContain(token);
		}
	});
});
