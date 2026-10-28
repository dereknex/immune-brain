import { describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
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

	it("states one pass/rework rule across the Guard, Reviewer prompt, mirrors and CODING_STANDARDS.md", () => {
		const rule = {
			guard: "A `rework` contains only blocking findings, at least one",
			prompt: "A rework carries only `kind: \"blocking\"` findings",
			standards: "a `rework` contains only blocking findings",
		};
		const guard = read("docs/reference/code-quality-guard.md");
		expect(guard).toContain(rule.guard);
		expect(guard).not.toContain("A passing Review has no findings");
		expect(read("plugins/immune-brain/dist/docs/reference/code-quality-guard.md")).toBe(guard);

		const promptSource = read("plugins/immune-brain/runtime/prompts/code-review.md");
		const prompt = promptSource.replace(/\s+/g, " ");
		expect(prompt).toContain(rule.prompt);
		expect(prompt).toContain("concrete input or state → observable wrong result");
		expect(prompt).toContain("outside that declaration is advisory");
		expect(read("plugins/immune-brain/dist/role-prompts/code-review.md")).toBe(promptSource);

		const standards = read("CODING_STANDARDS.md");
		expect(standards).toContain("docs/reference/code-quality-guard.md");
		expect(standards).toContain(rule.standards);
		expect(standards).toContain("concrete correctness, regression, security, or significant maintenance risk in the reviewed change");
	});

	it("delivers exit-preserving and requested test-first evidence in the Executor mirror", () => {
		const source = read("plugins/immune-brain/runtime/prompts/executor.md");
		expect(read("plugins/immune-brain/dist/role-prompts/executor.md")).toBe(source);
		for (const rule of ["pipefail", "full log", "business-assertion red", "corresponding green", "generated output"]) {
			expect(source).toContain(rule);
		}
	});

	it.each([0, 7])("keeps producer exit %s through truncated display", exit => {
		const result = spawnSync("bash", ["-o", "pipefail", "-c", '(printf "first\\nlast\\n"; exit "$1") | tail -1', "check", String(exit)], { encoding: "utf8" });
		expect(result.error).toBeUndefined();
		expect(result.status).toBe(exit);
		expect(result.stdout).toBe("last\n");
	});

	it("documents standalone repair and current user-facing boundaries", () => {
		expect(read("plugins/immune-brain/dist/fix-pr.md")).toContain("Code Quality Guard");
		expect(read("plugins/immune-brain/README.md")).toContain("Code Quality Guard");
		expect(read("plugins/immune-brain/USER_GUIDE.md")).toContain("Code Quality Guard");
		expect(read("docs/user_manual.md")).toContain("Code Quality Guard");
		expect(read("docs/reference/immune-brain-skills-guide.md")).toContain("Code Quality Guard");
	});
});
