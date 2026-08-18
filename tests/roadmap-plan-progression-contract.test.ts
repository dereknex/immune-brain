import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function read(path: string): string {
	return readFileSync(resolve(REPO_ROOT, path), "utf8");
}

const ROLE_PAIRS = [
	[
		"plugins/immune-brain/skills/imm-loop/SKILL.md",
		"plugins/immune-brain/dist/imm-loop.md",
	],
	[
		"plugins/immune-brain/runtime/prompts/qa.md",
		"plugins/immune-brain/dist/role-prompts/qa.md",
	],
	[
		"plugins/immune-brain/runtime/prompts/code-review.md",
		"plugins/immune-brain/dist/role-prompts/code-review.md",
	],
] as const;

describe("Roadmap successor workflow role contracts", () => {
	it("keeps source loaders and packaged role contracts aligned on user authority", () => {
		for (const [sourcePath, distPath] of ROLE_PAIRS) {
			const source = read(sourcePath);
			const packaged = read(distPath);
			for (const contract of [
				"awaiting_user_successor_decision",
				"--approve-successor",
				"literal user",
			]) {
				expect(source).toContain(contract);
				expect(packaged).toContain(contract);
			}
		}
	});

	it("orders Compounder and finish before the terminal user decision stop", () => {
		const loop = read("plugins/immune-brain/dist/imm-loop.md");
		for (const content of [loop]) {
			expect(content).toContain("internal Compounder");
			expect(content).toContain("terminal settlement");
			expect(content).toContain("recommended_authority: user");
			expect(content).toContain("must not dispatch");
		}
	});

	it("keeps QA and review closure separate from successor activation", () => {
		for (const role of ["qa", "code-review"]) {
			const content = read(`plugins/immune-brain/dist/role-prompts/${role}.md`);
			expect(content).toContain("approve a successor");
			expect(content).toContain("Internal role:");
		}
	});

	it("defines HANDOFF as a stale-tolerant non-authoritative mirror", () => {
		for (const path of [
			"docs/reference/HANDOFF-template.md",
			"plugins/immune-brain/dist/docs/reference/HANDOFF-template.md",
		]) {
			const content = read(path);
			expect(content).toContain(
				"## Successor decision (non-authoritative mirror)",
			);
			expect(content).toContain("Current Plan");
			expect(content).toContain("Current Phase");
			expect(content).toContain("Successor candidate");
			expect(content).toContain("Successor preconditions");
			expect(content).toContain("Expected Ledger revision");
			expect(content).toContain("Next user decision");
			expect(content).toContain("Deferred scope");
			expect(content).toContain("may be stale");
			expect(content).toContain("must never be parsed as transition authority");
		}
	});
});
