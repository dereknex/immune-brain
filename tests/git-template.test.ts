import { afterAll, describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { copyGitTemplate, gitTemplateInitCount } from "./helpers/git-template";

const roots: string[] = [];
afterAll(() => {
	for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function copy(): { root: string; head: string } {
	const root = mkdtempSync(join(tmpdir(), "git-template-test-"));
	roots.push(root);
	return { root, head: copyGitTemplate(root) };
}

const git = (root: string, ...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();

describe("git template fixture", () => {
	it("copies start at the same HEAD with the same tracked files and local identity", () => {
		const a = copy();
		const b = copy();
		expect(a.head).toBe(b.head);
		expect(git(a.root, "rev-parse", "HEAD")).toBe(a.head);
		expect(git(b.root, "rev-parse", "HEAD")).toBe(b.head);
		expect(git(a.root, "ls-files")).toBe(git(b.root, "ls-files"));
		for (const root of [a.root, b.root]) {
			expect(git(root, "config", "--local", "user.name")).toBe("Test");
			expect(git(root, "config", "--local", "user.email")).toBe("test@example.com");
			expect(git(root, "status", "--porcelain")).toBe("");
		}
	});

	it("a commit in one copy leaves another copy's HEAD and worktree unchanged", () => {
		const a = copy();
		const b = copy();
		writeFileSync(join(a.root, "change.txt"), "a\n");
		git(a.root, "add", "change.txt");
		git(a.root, "commit", "-q", "-m", "change");
		expect(git(a.root, "rev-parse", "HEAD")).not.toBe(a.head);
		expect(git(b.root, "rev-parse", "HEAD")).toBe(b.head);
		expect(existsSync(join(b.root, "change.txt"))).toBe(false);
		expect(git(b.root, "status", "--porcelain")).toBe("");
	});

	it("a copy holds no worktree metadata", () => {
		const { root } = copy();
		expect(existsSync(join(root, ".git", "worktrees"))).toBe(false);
		expect(git(root, "worktree", "list", "--porcelain").split("\n").filter((line) => line.startsWith("worktree ")))
			.toEqual([`worktree ${git(root, "rev-parse", "--show-toplevel")}`]);
	});

	it("initializes the template once per process", () => {
		copy();
		copy();
		expect(gitTemplateInitCount()).toBe(1);
	});
});
