import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

const CONTRACTS = [
	"plugins/immune-brain/skills/imm-brainstorm/SKILL.md",
	"plugins/immune-brain/skills/imm-planner/SKILL.md",
	"plugins/immune-brain/skills/imm-loop/SKILL.md",
	"plugins/immune-brain/dist/imm-brainstorm.md",
	"plugins/immune-brain/dist/imm-planner.md",
	"plugins/immune-brain/dist/imm-loop.md",
	"plugins/immune-brain/BASELINE.md",
	"plugins/immune-brain/dist/BASELINE.md",
];

const FORBIDDEN_FALLBACKS = [
	"fallback to Pi",
	"switch to Pi",
	"continue through Direct Path",
	"use Direct Path instead",
	"enroll from another worktree",
	"continue as unmanaged implementation",
];

describe("Managed native authority failure contract", () => {
	test("all Managed contracts retain the current Host authority boundary", () => {
		for (const path of CONTRACTS) {
			const contract = read(path).replace(/\s+/g, " ");
			expect(contract, path).toMatch(/current[- ]Host|current host/i);
		}
	});

	test("canonical contracts fail closed without cross-boundary fallback advice", () => {
		const canonical = CONTRACTS.map(read).join("\n").replace(/\s+/g, " ");
		expect(canonical).toContain("exactly one same-Host recovery action");
		expect(canonical).toContain("Never recommend another Host, worktree, Direct Path, unmanaged implementation, or automatic retry");
		for (const fallback of FORBIDDEN_FALLBACKS) expect(canonical).not.toContain(fallback);
	});

	test("retired Pi-only Enrollment wording stays absent", () => {
		const canonical = CONTRACTS.map(read).join("\n");
		expect(canonical).not.toContain("Planner's final `ctx.ui.custom` gate");
		expect(canonical).not.toContain("Pi host identity is implicit");
		expect(canonical).not.toContain("Enrollment remains a native TUI gate");
	});
});
