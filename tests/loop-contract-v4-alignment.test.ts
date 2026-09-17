import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");

function read(rel: string): string {
	return readFileSync(join(ROOT, rel), "utf8");
}

const KERNEL_SURFACE = [
	"advance_assurance",
	"submit_review",
	"request_authorization",
] as const;

// The packaged loop contract is shared by both Hosts, so routing and stop are
// named by the obligation they impose rather than by one Host's tool spelling.
// tests/packaged-contract-tool-surface.test.ts enforces that property generally.
const HOST_NEUTRAL_OBLIGATIONS = ["role-boundary route", "Kernel stop operation"] as const;

describe("loop contract v4 alignment", () => {
	test("packaged loop contract instructs the Kernel path and not the retired autowork playbook", () => {
		const dist = read("plugins/immune-brain/dist/imm-loop.md");
		for (const token of KERNEL_SURFACE) {
			expect(dist).toContain(token);
		}
		for (const obligation of HOST_NEUTRAL_OBLIGATIONS) {
			expect(dist.replace(/\s+/g, " ")).toContain(obligation);
		}
		expect(dist).not.toContain("imm-autowork");
		expect(dist).not.toMatch(/State Ledger authority/i);
		expect(dist).not.toMatch(/Run `imm-autowork --json`/);
		expect(dist).not.toMatch(/Consume `imm-autowork --json`/);
	});

	test("plugin README no longer names the removed imm-autowork command", () => {
		const readme = read("plugins/immune-brain/README.md");
		expect(readme).not.toMatch(/imm-loop` consumes `imm-autowork/);
		expect(readme).not.toContain("imm-autowork");
		expect(readme).not.toMatch(/Retired after v4 storage retirement/);
	});

	test("public Loop loader points to the packaged Kernel surface", () => {
		const skill = read("plugins/immune-brain/skills/imm-loop/SKILL.md");
		expect(skill).toContain("dist/imm-loop.md");
		expect(skill).toContain("canonical contract");
	});
});
