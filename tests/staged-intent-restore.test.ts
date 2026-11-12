// restoreStagedIntent must reproduce the snapshot and leave the Git index
// refreshed even when the rest of the worktree is dirty (8.1.3 regression:
// `update-index --refresh -- <path>` exited 1 on any other unstaged change).

import { afterEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { captureStagedIntent, restoreStagedIntent } from "../plugins/immune-brain/runtime/staged_intent";

const SIDECAR = "side.intent.json";
const roots: string[] = [];

function git(root: string, ...args: string[]): string {
	return execFileSync("git", args, { cwd: root, stdio: ["ignore", "pipe", "pipe"] }).toString();
}

function fixture(): string {
	const root = mkdtempSync(join(tmpdir(), "imm-restore-dirty-"));
	roots.push(root);
	git(root, "init", "-q");
	git(root, "config", "user.email", "t@example.com");
	git(root, "config", "user.name", "T");
	writeFileSync(join(root, "other.txt"), "other\n");
	writeFileSync(join(root, SIDECAR), '{"revision":1}\n');
	git(root, "add", ".");
	git(root, "commit", "-qm", "fixture");
	return root;
}

/** Stage a revision, then restore, as a failed `revise_intent` does. */
function reviseThenRestore(root: string): { index: string; expectedIndex: string } {
	const snapshot = captureStagedIntent(root, SIDECAR);
	writeFileSync(join(root, SIDECAR), '{"revision":2}\n');
	git(root, "add", "--", SIDECAR);
	restoreStagedIntent(root, snapshot);
	return { index: git(root, "ls-files", "--stage", "--", SIDECAR), expectedIndex: snapshot.index_state.toString() };
}

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("restoreStagedIntent in a dirty worktree", () => {
	test("restores bytes and index in a clean worktree and leaves no stat-only diff", () => {
		const root = fixture();
		const { index, expectedIndex } = reviseThenRestore(root);
		expect(index).toBe(expectedIndex.replace(/\0$/, "\n"));
		expect(readFileSync(join(root, SIDECAR), "utf8")).toBe('{"revision":1}\n');
		expect(git(root, "-c", "diff.autoRefreshIndex=false", "diff", "--name-only")).toBe("");
	});

	test("does not throw when another tracked file has an unstaged change", () => {
		const root = fixture();
		appendFileSync(join(root, "other.txt"), "work in progress\n");
		expect(() => reviseThenRestore(root)).not.toThrow();
		// Only the unrelated edit is reported; the restored sidecar is not unstaged.
		expect(git(root, "-c", "diff.autoRefreshIndex=false", "diff", "--name-only").trim()).toBe("other.txt");
	});

	test("keeps the snapshot's index entry when the sidecar itself had an unstaged edit", () => {
		const root = fixture();
		appendFileSync(join(root, SIDECAR), "\n");
		const { index, expectedIndex } = reviseThenRestore(root);
		// The refresh must not stage the worktree bytes over the captured entry.
		expect(index).toBe(expectedIndex.replace(/\0$/, "\n"));
		expect(git(root, "diff", "--name-only").trim()).toBe(SIDECAR);
	});
});
