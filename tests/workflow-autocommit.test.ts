import { afterEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { commitWorkflowPaths } from "../plugins/immune-brain/runtime/assurance/workflow_autocommit";

const SUBJECT = "chore(imm): commit Enrollment preconditions for demo-task";
const roots: string[] = [];
const git = (root: string, ...args: string[]) =>
	execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();

/** A committed repository with tracked files inside and outside the listed set. */
function repo(): string {
	const root = mkdtempSync(join(tmpdir(), "imm-autocommit-"));
	roots.push(root);
	git(root, "init", "-q", "-b", "main");
	git(root, "config", "user.name", "Project Author");
	git(root, "config", "user.email", "author@example.test");
	// A machine-wide core.hooksPath would hide the hooks these tests install.
	git(root, "config", "core.hooksPath", ".git/hooks");
	mkdirSync(join(root, "src"), { recursive: true });
	mkdirSync(join(root, "docs"), { recursive: true });
	for (const [path, text] of [["src/a.ts", "a0\n"], ["src/b.ts", "b0\n"], ["src/gone.ts", "gone\n"], ["other/staged.ts", "s0\n"], ["other/loose.ts", "l0\n"]]) {
		mkdirSync(join(root, path, ".."), { recursive: true });
		writeFileSync(join(root, path), text);
	}
	git(root, "add", "-A");
	git(root, "commit", "-qm", "fixture");
	return root;
}

/** Index entry and worktree bytes of one path, the observable state the commit must not disturb. */
const observed = (root: string, path: string) => ({
	index: git(root, "ls-files", "--stage", "--", path),
	worktree: readFileSync(join(root, path), "utf8"),
});
/** Status lines with their leading column intact; `git()` trims it away. */
const statusLines = (root: string) =>
	execFileSync("git", ["status", "--porcelain=v1", "--untracked-files=all"], { cwd: root, encoding: "utf8" }).split("\n").filter(Boolean).sort();
const committedPaths = (root: string, rev = "HEAD") => git(root, "show", "--name-only", "--format=", rev).split("\n").filter(Boolean).sort();
const state = (root: string) => ({
	head: git(root, "rev-parse", "HEAD"),
	branch: git(root, "symbolic-ref", "HEAD"),
	status: git(root, "status", "--porcelain=v1", "--untracked-files=all"),
	config: readFileSync(join(root, ".git/config"), "utf8"),
});

afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe("commitWorkflowPaths", () => {
	test("untracked, modified, staged and deleted listed paths land in exactly one commit", () => {
		const root = repo();
		const base = git(root, "rev-parse", "HEAD");
		const config = readFileSync(join(root, ".git/config"), "utf8");
		writeFileSync(join(root, "docs/new.md"), "new\n");
		writeFileSync(join(root, "src/a.ts"), "a1\n");
		writeFileSync(join(root, "src/b.ts"), "b1\n");
		git(root, "add", "--", "src/b.ts");
		rmSync(join(root, "src/gone.ts"));

		const result = commitWorkflowPaths(root, { paths: ["src/b.ts", "docs/new.md", "src/a.ts", "src/gone.ts", "src/a.ts"], subject: SUBJECT });

		expect(result).toEqual({ committed: true, commit: git(root, "rev-parse", "HEAD"), paths: ["docs/new.md", "src/a.ts", "src/b.ts", "src/gone.ts"] });
		expect(git(root, "rev-parse", "HEAD~1")).toBe(base);
		expect(git(root, "log", "-1", "--format=%s%n%an <%ae>")).toBe(`${SUBJECT}\nProject Author <author@example.test>`);
		expect(committedPaths(root)).toEqual(["docs/new.md", "src/a.ts", "src/b.ts", "src/gone.ts"]);
		expect(git(root, "show", "HEAD:src/a.ts")).toBe("a1");
		expect(git(root, "show", "HEAD:docs/new.md")).toBe("new");
		expect(git(root, "status", "--porcelain=v1")).toBe("");
		expect(git(root, "symbolic-ref", "HEAD")).toBe("refs/heads/main");
		expect(readFileSync(join(root, ".git/config"), "utf8")).toBe(config);
	});

	test("unrelated staged, unstaged and untracked paths stay byte-identical in the index and the worktree", () => {
		const root = repo();
		writeFileSync(join(root, "other/staged.ts"), "s1\n");
		git(root, "add", "--", "other/staged.ts");
		writeFileSync(join(root, "other/staged.ts"), "s2\n");
		writeFileSync(join(root, "other/loose.ts"), "l1\n");
		writeFileSync(join(root, "other/scratch.txt"), "notes\n");
		writeFileSync(join(root, "src/a.ts"), "a1\n");
		const before = { staged: observed(root, "other/staged.ts"), loose: observed(root, "other/loose.ts") };

		const result = commitWorkflowPaths(root, { paths: ["src/a.ts"], subject: SUBJECT });

		expect(result).toMatchObject({ committed: true, paths: ["src/a.ts"] });
		expect(committedPaths(root)).toEqual(["src/a.ts"]);
		expect(observed(root, "other/staged.ts")).toEqual(before.staged);
		expect(observed(root, "other/loose.ts")).toEqual(before.loose);
		expect(readFileSync(join(root, "other/scratch.txt"), "utf8")).toBe("notes\n");
		expect(statusLines(root)).toEqual(["?? other/scratch.txt", " M other/loose.ts", "MM other/staged.ts"].sort());
		expect(git(root, "diff", "--cached", "--name-only")).toBe("other/staged.ts");
	});

	test("an empty or all-clean list creates no commit", () => {
		const root = repo();
		writeFileSync(join(root, "other/loose.ts"), "l1\n");
		const before = state(root);
		expect(commitWorkflowPaths(root, { paths: [], subject: SUBJECT })).toEqual({ committed: false });
		expect(commitWorkflowPaths(root, { paths: ["src/a.ts", "src/b.ts", "docs/absent.md"], subject: SUBJECT })).toEqual({ committed: false });
		expect(state(root)).toEqual(before);
	});

	test("a failing pre-commit hook throws with Git's message, commits nothing and leaves no staged trace", () => {
		const root = repo();
		const hook = join(root, ".git/hooks/pre-commit");
		writeFileSync(hook, "#!/bin/sh\necho 'policy says no' >&2\nexit 1\n");
		chmodSync(hook, 0o755);
		writeFileSync(join(root, "src/a.ts"), "a1\n");
		writeFileSync(join(root, "docs/new.md"), "new\n");
		const before = state(root);

		expect(() => commitWorkflowPaths(root, { paths: ["src/a.ts", "docs/new.md"], subject: SUBJECT })).toThrow(/git commit failed: [\s\S]*policy says no/);

		// Nothing was retried around the hook, and the untracked path is untracked again.
		expect(state(root)).toEqual(before);
		expect(git(root, "diff", "--cached", "--name-only")).toBe("");
	});

	test("hooks run on a successful commit", () => {
		const root = repo();
		const hook = join(root, ".git/hooks/pre-commit");
		writeFileSync(hook, "#!/bin/sh\ntouch \"$(git rev-parse --git-dir)/hook-ran\"\n");
		chmodSync(hook, 0o755);
		writeFileSync(join(root, "src/a.ts"), "a1\n");
		expect(commitWorkflowPaths(root, { paths: ["src/a.ts"], subject: SUBJECT }).committed).toBe(true);
		expect(readFileSync(join(root, ".git/hook-ran"), "utf8")).toBe("");
	});

	test("an unmerged index is refused", () => {
		const root = repo();
		git(root, "checkout", "-q", "-b", "side");
		writeFileSync(join(root, "src/b.ts"), "side\n");
		git(root, "commit", "-qam", "side");
		git(root, "checkout", "-q", "main");
		writeFileSync(join(root, "src/b.ts"), "main\n");
		git(root, "commit", "-qam", "main");
		expect(() => git(root, "merge", "side")).toThrow();
		writeFileSync(join(root, "src/a.ts"), "a1\n");
		const head = git(root, "rev-parse", "HEAD");
		expect(() => commitWorkflowPaths(root, { paths: ["src/a.ts"], subject: SUBJECT })).toThrow(/unmerged index/);
		expect(git(root, "rev-parse", "HEAD")).toBe(head);
	});

	test("an assume-unchanged or skip-worktree flag on a listed path is refused; the same flag elsewhere is not", () => {
		for (const flag of ["--assume-unchanged", "--skip-worktree"]) {
			const root = repo();
			git(root, "update-index", flag, "src/a.ts");
			writeFileSync(join(root, "src/a.ts"), "hidden\n");
			writeFileSync(join(root, "src/b.ts"), "b1\n");
			const head = git(root, "rev-parse", "HEAD");
			expect(() => commitWorkflowPaths(root, { paths: ["src/a.ts", "src/b.ts"], subject: SUBJECT })).toThrow(/assume-unchanged or skip-worktree paths: src\/a\.ts/);
			expect(git(root, "rev-parse", "HEAD")).toBe(head);
			expect(commitWorkflowPaths(root, { paths: ["src/b.ts"], subject: SUBJECT })).toMatchObject({ committed: true, paths: ["src/b.ts"] });
		}
	});

	test("a path escaping the repository, pathspec magic and a directory are refused", () => {
		const root = repo();
		const outside = mkdtempSync(join(tmpdir(), "imm-autocommit-outside-"));
		roots.push(outside);
		writeFileSync(join(outside, "secret.txt"), "secret\n");
		symlinkSync(outside, join(root, "link"));
		writeFileSync(join(root, "src/a.ts"), "a1\n");
		writeFileSync(join(root, "src/b.ts"), "b1\n");
		const head = git(root, "rev-parse", "HEAD");
		for (const path of ["../escape.txt", "/etc/hosts", join(outside, "secret.txt"), "src/../../x", ".git/config", "", "src//a.ts"])
			expect(() => commitWorkflowPaths(root, { paths: [path], subject: SUBJECT })).toThrow(/outside the repository/);
		expect(() => commitWorkflowPaths(root, { paths: ["link/secret.txt"], subject: SUBJECT })).toThrow(/symbolic link/);
		expect(() => commitWorkflowPaths(root, { paths: ["src"], subject: SUBJECT })).toThrow(/file paths, not a directory/);
		// A glob is a literal file name, never a pattern over src/.
		expect(commitWorkflowPaths(root, { paths: ["src/*.ts", ":(glob)src/**"], subject: SUBJECT })).toEqual({ committed: false });
		expect(git(root, "rev-parse", "HEAD")).toBe(head);
		expect(() => commitWorkflowPaths(root, { paths: ["src/a.ts"], subject: "two\nlines" })).toThrow(/one-line subject/);
	});

	test("an aborted signal and a project root below the repository root make no commit", () => {
		const root = repo();
		writeFileSync(join(root, "src/a.ts"), "a1\n");
		const head = git(root, "rev-parse", "HEAD");
		expect(() => commitWorkflowPaths(root, { paths: ["src/a.ts"], subject: SUBJECT, signal: AbortSignal.abort() })).toThrow();
		expect(() => commitWorkflowPaths(join(root, "src"), { paths: ["a.ts"], subject: SUBJECT })).toThrow(/repository root/);
		expect(git(root, "rev-parse", "HEAD")).toBe(head);
	});
});
