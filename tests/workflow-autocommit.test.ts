import { afterEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { commitSettledDelivery, commitWorkflowPaths, settleCommitSubject, withSettleCommit } from "../plugins/immune-brain/runtime/assurance/workflow_autocommit";
import { canonicalIntentHash, parseTaskIntentV1 } from "../plugins/immune-brain/runtime/kernel/intent";
import { recoverKernelStoreFollowUps } from "../plugins/immune-brain/runtime/kernel/storage";
import { taskStatusIdentity } from "../plugins/immune-brain/runtime/workspace_scope";
import { seedKernelRunForTest } from "./fixtures/mutation-authority-test-seam";

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

	test("a listed staged change restored to HEAD in the worktree stays staged", () => {
		const root = repo();
		writeFileSync(join(root, "src/a.ts"), "staged user content\n");
		git(root, "add", "--", "src/a.ts");
		writeFileSync(join(root, "src/a.ts"), "a0\n");
		const staged = observed(root, "src/a.ts");
		const before = state(root);
		expect(commitWorkflowPaths(root, { paths: ["src/a.ts"], subject: SUBJECT })).toEqual({ committed: false });
		expect(state(root)).toEqual(before);
		writeFileSync(join(root, "src/b.ts"), "b1\n");
		expect(commitWorkflowPaths(root, { paths: ["src/a.ts", "src/b.ts"], subject: SUBJECT })).toMatchObject({ committed: true, paths: ["src/b.ts"] });
		expect(committedPaths(root)).toEqual(["src/b.ts"]);
		expect(observed(root, "src/a.ts")).toEqual(staged);
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

	for (const name of ["pre-commit", "prepare-commit-msg", "commit-msg"]) test(`${name} cannot add an unrelated path to the final commit`, () => {
		const root = repo();
		writeFileSync(join(root, "other/staged.ts"), "s1\n");
		git(root, "add", "--", "other/staged.ts");
		writeFileSync(join(root, "other/staged.ts"), "s2\n");
		writeFileSync(join(root, "src/a.ts"), "a1\n");
		writeFileSync(join(root, "docs/new.md"), "new\n");
		const before = state(root);
		const unrelated = observed(root, "other/staged.ts");
		const hook = join(root, `.git/hooks/${name}`);
		writeFileSync(hook, "#!/bin/sh\ngit add -- other/staged.ts\n");
		chmodSync(hook, 0o755);
		if (name === "pre-commit") {
			expect(() => commitWorkflowPaths(root, { paths: ["src/a.ts", "docs/new.md"], subject: SUBJECT })).toThrow(/automatic commit refuses hook changes/);
			expect(state(root)).toEqual(before);
		} else {
			expect(commitWorkflowPaths(root, { paths: ["src/a.ts", "docs/new.md"], subject: SUBJECT }).committed).toBe(true);
			expect(committedPaths(root)).toEqual(["docs/new.md", "src/a.ts"]);
		}
		expect(observed(root, "other/staged.ts")).toEqual(unrelated);
	});
	for (const alteration of ["remove path", "change subject"]) test(`hooks cannot ${alteration} in the final commit`, () => {
		const root = repo();
		writeFileSync(join(root, "src/a.ts"), "a1\n");
		const before = state(root);
		const hook = join(root, `.git/hooks/${alteration === "remove path" ? "pre-commit" : "commit-msg"}`);
		writeFileSync(hook, alteration === "remove path"
			? "#!/bin/sh\ngit reset -q HEAD -- src/a.ts\n"
			: "#!/bin/sh\necho 'changed subject' > \"$1\"\n");
		chmodSync(hook, 0o755);
		expect(() => commitWorkflowPaths(root, { paths: ["src/a.ts"], subject: SUBJECT })).toThrow();
		expect(state(root)).toEqual(before);
	});
	test("a configured reference-transaction hook keeps its input and phases", () => {
		const root = repo();
		mkdirSync(join(root, "custom-hooks"));
		git(root, "config", "core.hooksPath", "custom-hooks");
		const hook = join(root, "custom-hooks/reference-transaction");
		writeFileSync(hook, "#!/bin/sh\necho \"$1\" >> .git/ref-phases\ncat >> .git/ref-input\n");
		chmodSync(hook, 0o755);
		writeFileSync(join(root, "src/a.ts"), "a1\n");
		const config = readFileSync(join(root, ".git/config"), "utf8");
		expect(commitWorkflowPaths(root, { paths: ["src/a.ts"], subject: SUBJECT }).committed).toBe(true);
		const phases = readFileSync(join(root, ".git/ref-phases"), "utf8").trim().split("\n");
		expect(phases).toContain("prepared");
		expect(phases.at(-1)).toBe("committed");
		expect(readFileSync(join(root, ".git/ref-input"), "utf8")).toContain(" refs/heads/main");
		expect(readFileSync(join(root, ".git/config"), "utf8")).toBe(config);
	});
	for (const refusal of [false, true]) test(`a user guard.cjs stays byte-identical when hooks ${refusal ? "refuse" : "accept"}`, () => {
		const root = repo();
		mkdirSync(join(root, "custom-hooks"));
		git(root, "config", "core.hooksPath", "custom-hooks");
		writeFileSync(join(root, "custom-hooks/guard.cjs"), "// user-owned hook helper\n");
		git(root, "add", "--", "custom-hooks/guard.cjs");
		git(root, "commit", "-qm", "existing hook helper");
		const helper = observed(root, "custom-hooks/guard.cjs");
		const hook = join(root, "custom-hooks/pre-commit");
		writeFileSync(hook, `#!/bin/sh\ncat custom-hooks/guard.cjs > .git/helper-used\nexit ${refusal ? 1 : 0}\n`);
		chmodSync(hook, 0o755);
		writeFileSync(join(root, "src/a.ts"), "a1\n");
		const before = state(root);
		if (refusal) {
			expect(() => commitWorkflowPaths(root, { paths: ["src/a.ts"], subject: SUBJECT })).toThrow();
			expect(state(root)).toEqual(before);
		} else {
			expect(commitWorkflowPaths(root, { paths: ["src/a.ts"], subject: SUBJECT }).committed).toBe(true);
			expect(committedPaths(root)).toEqual(["src/a.ts"]);
		}
		expect(observed(root, "custom-hooks/guard.cjs")).toEqual(helper);
		expect(readFileSync(join(root, ".git/helper-used"), "utf8")).toBe(helper.worktree);
	});

	test("hooks retain their invocation location when loading a parent-directory policy", () => {
		const root = repo();
		mkdirSync(join(root, ".githooks/_"), { recursive: true });
		git(root, "config", "core.hooksPath", ".githooks/_");
		writeFileSync(join(root, ".githooks/pre-commit"), "#!/bin/sh\necho 'parent-directory policy says no' >&2\nexit 1\n");
		const hook = join(root, ".githooks/_/pre-commit");
		writeFileSync(hook, '#!/bin/sh\nhelper="$(dirname "$0")/../pre-commit"\n[ "$(git config core.hooksPath)" = ".githooks/_" ] || exit 0\n[ -f "$helper" ] || exit 0\nexec sh "$helper" "$@"\n');
		chmodSync(hook, 0o755);
		writeFileSync(join(root, "src/a.ts"), "a1\n");
		const before = state(root);
		expect(() => git(root, "commit", "--only", "-m", SUBJECT, "--", "src/a.ts")).toThrow(/parent-directory policy says no/);
		expect(() => commitWorkflowPaths(root, { paths: ["src/a.ts"], subject: SUBJECT })).toThrow(/parent-directory policy says no/);
		expect(state(root)).toEqual(before);
	});

	for (const name of ["pre-commit", "reference-transaction"]) {
		for (const glob of [undefined, "1"]) {
			test(`${name} keeps the caller's wildcard pathspec policy (GIT_GLOB_PATHSPECS=${glob})`, () => {
				const keys = ["GIT_LITERAL_PATHSPECS", "GIT_GLOB_PATHSPECS", "GIT_NOGLOB_PATHSPECS", "GIT_ICASE_PATHSPECS"];
				const saved = keys.map((key) => process.env[key]);
				try {
					for (const key of keys) delete process.env[key];
					if (glob !== undefined) process.env.GIT_GLOB_PATHSPECS = glob;
					const root = repo();
					const hook = join(root, ".git/hooks", name);
					const check = name === "pre-commit"
						? "selected=$(git diff --cached --name-only -- '**/*.ts')\n"
						: '[ "$1" = "prepared" ] || exit 0\nread old next ref\nselected=$(git diff --name-only "$old" "$next" -- \'**/*.ts\')\n';
					writeFileSync(hook, `#!/bin/sh\n${check}[ -z "$selected" ] && exit 0\necho 'wildcard policy says no' >&2\nexit 1\n`);
					chmodSync(hook, 0o755);
					writeFileSync(join(root, "src/a.ts"), "a1\n");
					const before = state(root);
					expect(() => git(root, "commit", "--only", "-m", SUBJECT, "--", "src/a.ts")).toThrow(/wildcard policy says no/);
					expect(() => commitWorkflowPaths(root, { paths: ["src/a.ts"], subject: SUBJECT })).toThrow(/wildcard policy says no/);
					expect(state(root)).toEqual(before);
				} finally {
					keys.forEach((key, index) => { if (saved[index] === undefined) delete process.env[key]; else process.env[key] = saved[index]; });
				}
			});
		}
	}

	test("disabled hooks via /dev/null permit a guarded commit without changing configuration", () => {
		const root = repo();
		git(root, "config", "core.hooksPath", "/dev/null");
		writeFileSync(join(root, "src/a.ts"), "a1\n");
		expect(commitWorkflowPaths(root, { paths: ["src/a.ts"], subject: SUBJECT })).toMatchObject({ committed: true, paths: ["src/a.ts"] });
		expect(committedPaths(root)).toEqual(["src/a.ts"]);
		expect(git(root, "config", "core.hooksPath")).toBe("/dev/null");
	});

	test("a refusing reference-transaction hook still vetoes the commit", () => {
		const root = repo();
		const hook = join(root, ".git/hooks/reference-transaction");
		writeFileSync(hook, "#!/bin/sh\nif [ \"$1\" = prepared ]; then echo 'ref policy says no' >&2; exit 1; fi\n");
		chmodSync(hook, 0o755);
		writeFileSync(join(root, "src/a.ts"), "a1\n");
		const before = state(root);
		expect(() => commitWorkflowPaths(root, { paths: ["src/a.ts"], subject: SUBJECT })).toThrow(/ref policy says no/);
		expect(state(root)).toEqual(before);
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

describe("settle commit under the Git integration preference (ADR 0024, SCN-4)", () => {
	const taskId = "settle-demo";
	const intentPath = `docs/plans/${taskId}.intent.json`;
	/**
	 * A task settled `done` over a staged in-scope edit, beside staged and
	 * unstaged out-of-scope dirt. The final attestation binds the real scoped
	 * identity, as a settlement in the user's working tree does.
	 */
	function settled(mode: "auto" | "manual" | null) {
		const root = repo();
		const intent = parseTaskIntentV1({ contract: "assurance_kernel/task_intent/v1", task_id: taskId, owner: "user", goal: "settle",
			risk: "routine", revision: 1, scope_hint: ["src/a.ts", intentPath],
			acceptance: [{ id: "AC1", assertion: "settle", verification: "true" }] });
		mkdirSync(join(root, "docs/plans"), { recursive: true });
		writeFileSync(join(root, intentPath), `${JSON.stringify(intent, null, 2)}\n`);
		writeFileSync(join(root, ".gitignore"), ".imm/\n");
		if (mode) writeFileSync(join(root, "AGENTS.md"), `# Agent Instructions\n\n- Git integration: ${mode}\n`);
		git(root, "add", "-A");
		git(root, "commit", "-qm", "plan");
		const base = git(root, "rev-parse", "HEAD");
		writeFileSync(join(root, "src/a.ts"), "a1\n");
		git(root, "add", "--", "src/a.ts");
		writeFileSync(join(root, "other/staged.ts"), "s1\n");
		git(root, "add", "--", "other/staged.ts");
		writeFileSync(join(root, "other/loose.ts"), "l1\n");
		const draft = { contract: "assurance_kernel/task_record/v4", task_id: taskId, intent_snapshot: intent,
			intent_ref: { path: intentPath, content_hash: canonicalIntentHash(intent) }, git_base_head: base };
		const diffHash = taskStatusIdentity(root, draft).diff_hash;
		seedKernelRunForTest(root, { task_id: taskId, terminal: { lifecycle: "done" }, record: { ...draft,
			lifecycle: "done", artifact_state: "frozen", baseline: `sha256:${"a".repeat(64)}`, findings: [], history: [],
			attestations: [{ id: "qa-1", kind: "qa", authority_role: "qa", actor_id: "qa", task_revision: 1,
				intent_content_hash: canonicalIntentHash(intent), diff_hash: diffHash, summary: "passed",
				acceptance_results: [{ acceptance_id: "AC1", status: "passed", summary: "passed" }] }] } });
		recoverKernelStoreFollowUps(root, taskId);
		return { root, base };
	}

	test("auto commits exactly the settled scoped paths and leaves every other path untouched", () => {
		const { root, base } = settled("auto");
		const outside = [observed(root, "other/staged.ts"), observed(root, "other/loose.ts")];
		const result = commitSettledDelivery(root, taskId);
		expect(result).toMatchObject({ mode: "auto", committed: true, paths: ["src/a.ts"] });
		expect(git(root, "rev-parse", "HEAD^")).toBe(base);
		expect(git(root, "log", "-1", "--format=%s")).toBe(settleCommitSubject(taskId));
		expect(git(root, "show", "--name-only", "--format=", "HEAD")).toBe("src/a.ts");
		expect([observed(root, "other/staged.ts"), observed(root, "other/loose.ts")]).toEqual(outside);
		// The seam a Host's completion result passes through carries the outcome once.
		const completion = withSettleCommit(root, taskId, { state: "completed" });
		expect(completion).toMatchObject({ state: "completed", settle_commit: { committed: false } });
		expect(git(root, "rev-parse", "HEAD^")).toBe(base);
	});

	for (const mode of ["manual", null] as const) test(`${mode ? "manual" : "no directive"} commits nothing at settlement`, () => {
		const { root, base } = settled(mode);
		const status = statusLines(root);
		expect(commitSettledDelivery(root, taskId)).toBeNull();
		expect(withSettleCommit(root, taskId, { state: "completed" })).toEqual({ state: "completed" });
		expect(git(root, "rev-parse", "HEAD")).toBe(base);
		expect(statusLines(root)).toEqual(status);
	});

	test("auto never sweeps an in-scope edit made after settlement into the commit", () => {
		const { root, base } = settled("auto");
		writeFileSync(join(root, "src/a.ts"), "a2\n");
		git(root, "add", "--", "src/a.ts");
		expect(commitSettledDelivery(root, taskId)).toMatchObject({ committed: false, reason: expect.stringContaining("changed after settlement") });
		expect(git(root, "rev-parse", "HEAD")).toBe(base);
	});

	test("auto makes no commit for content the user already committed", () => {
		const { root } = settled("auto");
		git(root, "commit", "-qm", "user commit", "--", "src/a.ts");
		const head = git(root, "rev-parse", "HEAD");
		expect(commitSettledDelivery(root, taskId)).toMatchObject({ committed: false });
		expect(git(root, "rev-parse", "HEAD")).toBe(head);
	});

	test("a result that did not settle done passes through untouched", () => {
		const { root, base } = settled("auto");
		const review = { state: "review_ready" };
		expect(withSettleCommit(root, taskId, review)).toBe(review);
		expect(git(root, "rev-parse", "HEAD")).toBe(base);
	});
});
