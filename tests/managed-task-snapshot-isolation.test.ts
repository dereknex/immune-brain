import { execFileSync } from "node:child_process";
import { describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	captureGitTaskSnapshot,
	setGitTaskSnapshotTestHook,
	taskDiffHash,
} from "../plugins/immune-brain/runtime/workspace_scope";

function git(root: string, args: string[]): string {
	return execFileSync("git", args, {
		cwd: root,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	}).trim();
}

function repo(): string {
	const root = mkdtempSync(join(tmpdir(), "managed-task-snapshot-"));
	git(root, ["init", "-q"]);
	git(root, ["config", "user.email", "test@example.com"]);
	git(root, ["config", "user.name", "Test"]);
	writeFileSync(join(root, "task.ts"), "export const task = 'base';\n");
	writeFileSync(join(root, "outside.ts"), "export const outside = 'base';\n");
	git(root, ["add", "task.ts", "outside.ts"]);
	git(root, ["commit", "-qm", "fixture"]);
	return root;
}

describe("managed task snapshot isolation", () => {
	test("binds identity to the staged in-scope index entry", () => {
		const root = repo();
		try {
			writeFileSync(join(root, "task.ts"), "export const task = 'staged';\n");
			git(root, ["add", "task.ts"]);

			const snapshot = captureGitTaskSnapshot(root, ["task.ts"]);
			const indexOid = git(root, ["rev-parse", ":task.ts"]);
			const baseOid = git(root, ["rev-parse", "HEAD:task.ts"]);

			expect(snapshot).toEqual({
				kind: "git-task-index-v1",
				repository_root: realpathSync(root),
				head: git(root, ["rev-parse", "HEAD"]),
				scope: ["task.ts"],
				staged_files: {
					"task.ts": {
						status: "modified",
						mode: "100644",
						oid: indexOid,
						base_mode: "100644",
						base_oid: baseOid,
					},
				},
			});
			expect(taskDiffHash(root, ["task.ts"])).toMatch(/^sha256:[a-f0-9]{64}$/);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("ignores out-of-scope worktree and index changes", () => {
		const root = repo();
		try {
			writeFileSync(join(root, "task.ts"), "export const task = 'staged';\n");
			git(root, ["add", "task.ts"]);
			writeFileSync(join(root, "outside.ts"), "export const outside = 'dirty-one';\n");
			const initial = taskDiffHash(root, ["task.ts"]);

			writeFileSync(join(root, "outside.ts"), "export const outside = 'dirty-two';\n");
			expect(taskDiffHash(root, ["task.ts"])).toBe(initial);
			git(root, ["add", "outside.ts"]);
			expect(taskDiffHash(root, ["task.ts"])).toBe(initial);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("rejects in-scope worktree drift after staging", () => {
		const root = repo();
		try {
			writeFileSync(join(root, "task.ts"), "export const task = 'staged';\n");
			git(root, ["add", "task.ts"]);
			writeFileSync(join(root, "task.ts"), "export const task = 'unstaged';\n");
			expect(() => taskDiffHash(root, ["task.ts"])).toThrow(/unstaged or untracked/i);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("binds staged additions and deletions to index and HEAD objects", () => {
		const root = repo();
		try {
			rmSync(join(root, "task.ts"));
			writeFileSync(join(root, "new.ts"), "export const added = true;\n");
			git(root, ["add", "task.ts", "new.ts"]);

			const snapshot = captureGitTaskSnapshot(root, ["new.ts", "task.ts"]);
			expect(snapshot.staged_files["new.ts"]).toEqual({
				status: "added",
				mode: "100644",
				oid: git(root, ["rev-parse", ":new.ts"]),
				base_mode: null,
				base_oid: null,
			});
			expect(snapshot.staged_files["task.ts"]).toEqual({
				status: "deleted",
				mode: null,
				oid: null,
				base_mode: "100644",
				base_oid: git(root, ["rev-parse", "HEAD:task.ts"]),
			});
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("binds mode-only changes independently of blob content", () => {
		const root = repo();
		try {
			chmodSync(join(root, "task.ts"), 0o755);
			git(root, ["add", "task.ts"]);
			const entry = captureGitTaskSnapshot(root, ["task.ts"]).staged_files["task.ts"];
			expect(entry.mode).toBe("100755");
			expect(entry.base_mode).toBe("100644");
			expect(entry.oid).toBe(entry.base_oid);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("binds symlink link bytes without following the target", () => {
		const root = repo();
		try {
			rmSync(join(root, "task.ts"));
			symlinkSync("outside.ts", join(root, "task.ts"));
			git(root, ["add", "task.ts"]);
			const entry = captureGitTaskSnapshot(root, ["task.ts"]).staged_files["task.ts"];
			expect(entry.mode).toBe("120000");
			expect(entry.oid).toBe(git(root, ["rev-parse", ":task.ts"]));
			expect(entry.base_mode).toBe("100644");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("changes identity when the committed baseline advances", () => {
		const root = repo();
		try {
			writeFileSync(join(root, "task.ts"), "export const task = 'staged';\n");
			git(root, ["add", "task.ts"]);
			const before = taskDiffHash(root, ["task.ts"]);

			writeFileSync(join(root, "outside.ts"), "export const outside = 'committed';\n");
			git(root, ["add", "outside.ts"]);
			git(root, ["commit", "-qm", "outside", "--", "outside.ts"]);
			expect(taskDiffHash(root, ["task.ts"])).not.toBe(before);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("binds clean no-op snapshots while rejecting untracked in-scope files", () => {
		const emptyRoot = repo();
		const untrackedRoot = repo();
		try {
			const snapshot = captureGitTaskSnapshot(emptyRoot, ["task.ts"]);
			expect(snapshot.staged_files).toEqual({});
			expect(taskDiffHash(emptyRoot, ["task.ts"])).toMatch(/^sha256:[a-f0-9]{64}$/);
			writeFileSync(join(untrackedRoot, "new.ts"), "export const value = 'untracked';\n");
			expect(() => taskDiffHash(untrackedRoot, ["new.ts"])).toThrow(/unstaged or untracked/i);
		} finally {
			rmSync(emptyRoot, { recursive: true, force: true });
			rmSync(untrackedRoot, { recursive: true, force: true });
		}
	});

	test("rejects intent-to-add, sparse checkout, and gitlink entries", () => {
		const intentRoot = repo();
		const sparseRoot = repo();
		const gitlinkRoot = repo();
		try {
			writeFileSync(join(intentRoot, "new.ts"), "export const value = 1;\n");
			git(intentRoot, ["add", "-N", "new.ts"]);
			expect(() => taskDiffHash(intentRoot, ["new.ts"])).toThrow();

			writeFileSync(join(sparseRoot, "task.ts"), "export const task = 'staged';\n");
			git(sparseRoot, ["add", "task.ts"]);
			git(sparseRoot, ["config", "core.sparseCheckout", "true"]);
			expect(() => taskDiffHash(sparseRoot, ["task.ts"])).toThrow(/sparse/i);

			const commitOid = git(gitlinkRoot, ["rev-parse", "HEAD"]);
			execFileSync("git", ["clone", "-q", gitlinkRoot, join(gitlinkRoot, "gitlink")]);
			git(gitlinkRoot, ["update-index", "--add", "--cacheinfo", `160000,${commitOid},gitlink`]);
			expect(() => taskDiffHash(gitlinkRoot, ["gitlink"])).toThrow(/unsupported mode 160000/i);
		} finally {
			rmSync(intentRoot, { recursive: true, force: true });
			rmSync(sparseRoot, { recursive: true, force: true });
			rmSync(gitlinkRoot, { recursive: true, force: true });
		}
	});

	test("rejects an index mutation between manifest capture and revalidation", () => {
		const root = repo();
		let resetHook = () => {};
		try {
			writeFileSync(join(root, "task.ts"), "export const task = 'first';\n");
			git(root, ["add", "task.ts"]);
			let calls = 0;
			resetHook = setGitTaskSnapshotTestHook(() => {
				if (calls++ > 0) return;
				writeFileSync(join(root, "task.ts"), "export const task = 'second';\n");
				git(root, ["add", "task.ts"]);
			});
			expect(() => taskDiffHash(root, ["task.ts"])).toThrow(/changed while being captured/i);
		} finally {
			resetHook();
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("rejects unmerged stages and case-fold index collisions", () => {
		const conflictRoot = repo();
		const collisionRoot = repo();
		try {
			const baseBranch = git(conflictRoot, ["rev-parse", "--abbrev-ref", "HEAD"]);
			git(conflictRoot, ["checkout", "-qb", "side"]);
			writeFileSync(join(conflictRoot, "task.ts"), "export const task = 'side';\n");
			git(conflictRoot, ["commit", "-qam", "side"]);
			git(conflictRoot, ["checkout", "-q", baseBranch]);
			writeFileSync(join(conflictRoot, "task.ts"), "export const task = 'main';\n");
			git(conflictRoot, ["commit", "-qam", "main"]);
			try {
				execFileSync("git", ["merge", "side"], { cwd: conflictRoot, stdio: "ignore" });
			} catch {
				// The conflict is the fixture state.
			}
			expect(() => taskDiffHash(conflictRoot, ["task.ts"])).toThrow(/unmerged/i);

			git(collisionRoot, ["config", "core.ignorecase", "false"]);
			const oid = git(collisionRoot, ["rev-parse", "HEAD:task.ts"]);
			git(collisionRoot, ["update-index", "--add", "--cacheinfo", `100644,${oid},Case.ts`]);
			git(collisionRoot, ["update-index", "--add", "--cacheinfo", `100644,${oid},case.ts`]);
			expect(() => taskDiffHash(collisionRoot, ["*.ts"])).toThrow(/case-fold path collision/i);
		} finally {
			rmSync(conflictRoot, { recursive: true, force: true });
			rmSync(collisionRoot, { recursive: true, force: true });
		}
	});

	test("rejects invalid UTF-8 path bytes from the Git index", () => {
		const root = repo();
		try {
			const oid = git(root, ["rev-parse", "HEAD:task.ts"]);
			const input = Buffer.concat([
				Buffer.from(`100644 ${oid}\tbad-`, "utf8"),
				Buffer.from([0xff]),
				Buffer.from(".ts\0", "utf8"),
			]);
			execFileSync("git", ["update-index", "-z", "--index-info"], {
				cwd: root,
				input,
				stdio: ["pipe", "ignore", "pipe"],
			});
			expect(() => taskDiffHash(root, ["*.ts"])).toThrow(/invalid UTF-8/i);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
