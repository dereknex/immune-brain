import { afterEach, describe, expect, test } from "bun:test";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inspectEnrollmentGitBase } from "../plugins/immune-brain/runtime/assurance/enrollment_git_base";

// ADR 0036: an unborn HEAD refuses drive, so this Git-base read only reports
// which base exists. Nothing here creates a commit or a ref.

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const git = (root: string, ...args: string[]) =>
	execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
function fixture() {
	const root = mkdtempSync(join(tmpdir(), "imm-git-base-"));
	roots.push(root);
	git(root, "init", "-q", "-b", "main");
	git(root, "config", "user.name", "Project Author");
	git(root, "config", "user.email", "author@example.test");
	return root;
}
const refExists = (root: string, ref: string) => spawnSync("git", ["show-ref", "--verify", "--quiet", ref], { cwd: root }).status === 0;
const headReads = (root: string) => spawnSync("git", ["rev-parse", "--verify", "HEAD"], { cwd: root }).status === 0;

describe("inspectEnrollmentGitBase", () => {
	test("a committed HEAD reports that commit", () => {
		const root = fixture();
		writeFileSync(join(root, "base.txt"), "base\n");
		git(root, "add", "-A");
		git(root, "commit", "-qm", "base");
		expect(inspectEnrollmentGitBase(root)).toEqual({ state: "committed", head: git(root, "rev-parse", "HEAD") });
	});

	test("an absent branch is reported unborn without writing a ref or a commit", () => {
		const root = fixture();
		writeFileSync(join(root, "staged.txt"), "staged\n");
		git(root, "add", "--", "staged.txt");
		expect(inspectEnrollmentGitBase(root)).toEqual({ state: "unborn", branch: "refs/heads/main" });
		expect(refExists(root, "refs/heads/main")).toBe(false);
		expect(headReads(root)).toBe(false);
		expect(git(root, "ls-files", "--cached")).toBe("staged.txt");
	});

	test("a corrupt branch ref is an error and its bytes are left alone", () => {
		const root = fixture();
		const bytes = `${"a".repeat(40)}\n`;
		writeFileSync(join(root, ".git/refs/heads/main"), bytes);
		expect(() => inspectEnrollmentGitBase(root)).toThrow("Enrollment Git HEAD is invalid");
		expect(readFileSync(join(root, ".git/refs/heads/main"), "utf8")).toBe(bytes);
	});

	test("a directory outside any Git repository has no base", () => {
		const root = mkdtempSync(join(tmpdir(), "imm-not-git-"));
		roots.push(root);
		expect(() => inspectEnrollmentGitBase(root)).toThrow();
	});

	test("a detached HEAD that names no commit is not a base", () => {
		const root = mkdtempSync(join(tmpdir(), "imm-detached-"));
		roots.push(root);
		git(root, "init", "-q");
		writeFileSync(join(root, ".git/HEAD"), `${"a".repeat(40)}\n`);
		expect(() => inspectEnrollmentGitBase(root)).toThrow();
	});
});
