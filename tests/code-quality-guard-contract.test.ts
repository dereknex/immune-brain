import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DIST_DOC_ENTRIES } from "../scripts/dist-sync-manifest.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function read(path: string): string {
	return readFileSync(resolve(ROOT, path), "utf8");
}

describe("Code Quality Guard contract", () => {
	it("publishes the canonical reference and its packaged mirror", () => {
		const source = "docs/reference/code-quality-guard.md";
		const packaged = "plugins/immune-brain/dist/docs/reference/code-quality-guard.md";
		expect(existsSync(resolve(ROOT, source))).toBe(true);
		expect(existsSync(resolve(ROOT, packaged))).toBe(true);
		expect(read(packaged)).toBe(read(source));
		expect(DIST_DOC_ENTRIES).toContainEqual({
			rel: "reference/code-quality-guard.md",
			mode: "mirror",
		});
	});

	it("keeps correctness guards role-specific and style-neutral", () => {
		const reference = read("docs/reference/code-quality-guard.md");
		expect(reference).toContain("## Correctness Invariants");
		expect(reference).toContain("## Maintainability Heuristics");
		expect(reference).toContain("## Review Decision Policy");
		expect(reference).toContain("Do not turn an unknown or unrecoverable error into");
		expect(reference).toContain("There are no hard line-count");

		for (const role of ["executor", "code-review", "pr-fix", "test-fixer"]) {
			const prompt = read(`plugins/immune-brain/runtime/prompts/${role}.md`);
			expect(prompt).toContain("Code Quality Guard");
		}
		expect(read("plugins/immune-brain/runtime/prompts/executor.md")).toContain("real implementation");
		expect(read("plugins/immune-brain/runtime/prompts/code-review.md")).toContain("style-only");
		expect(read("plugins/immune-brain/runtime/prompts/pr-fix.md")).toContain("weaken tests");
		expect(read("plugins/immune-brain/runtime/prompts/test-fixer.md")).toContain("test intent");
		for (const role of ["qa", "ui-review", "arch-explorer", "advisory-reviewer", "compounder"]) {
			expect(read(`plugins/immune-brain/runtime/prompts/${role}.md`)).not.toContain("Code Quality Guard");
		}
	});

	it("documents standalone repair and current user-facing boundaries", () => {
		expect(read("plugins/immune-brain/dist/imm-pr-fix.md")).toContain("Code Quality Guard");
		expect(read("plugins/immune-brain/README.md")).toContain("Code Quality Guard");
		expect(read("plugins/immune-brain/USER_GUIDE.md")).toContain("Code Quality Guard");
		expect(read("docs/user_manual.md")).toContain("Code Quality Guard");
		expect(read("docs/reference/immune-brain-skills-guide.md")).toContain("Code Quality Guard");
	});
});
