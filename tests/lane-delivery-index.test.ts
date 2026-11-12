// A Lane's index must carry stat data after its delivery is indexed: task
// snapshots diff with `diff.autoRefreshIndex=false`, and a zero-stat index
// makes every tracked file look unstaged. git 2.43 (Ubuntu 24.04) `read-tree`
// writes such an index; git 2.56 (CI) no longer does, so these assertions are
// about the state after the helper and hold on both.

import { afterEach, describe, expect, test } from "bun:test";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { readLaneDeliveryIntoIndex } from "../plugins/immune-brain/runtime/unattended/batch_git";

const roots: string[] = [];
const git = (root: string, ...args: string[]) =>
	execFileSync("git", args, { cwd: root, stdio: ["ignore", "pipe", "pipe"] }).toString();
/** The exact read the task snapshot makes. */
const unstaged = (root: string) =>
	// Exit 1 means "differences"; only a status above that is a git failure.
	spawnSync("git", ["--no-optional-locks", "-c", "diff.autoRefreshIndex=false", "-C", root, "diff", "--exit-code", "--no-renames", "--name-only", "--"],
		{ encoding: "utf8" }).stdout.trim();

function lane(): { root: string; commit: string } {
	const root = mkdtempSync(join(tmpdir(), "imm-lane-index-"));
	roots.push(root);
	git(root, "init", "-q");
	git(root, "config", "user.email", "t@example.com");
	git(root, "config", "user.name", "T");
	git(root, "config", "commit.gpgsign", "false");
	mkdirSync(join(root, "src"));
	writeFileSync(join(root, "src/impl.ts"), "export {};\n");
	writeFileSync(join(root, "out.ts"), "out\n");
	git(root, "add", ".");
	git(root, "commit", "-qm", "base");
	writeFileSync(join(root, "src/impl.ts"), "export const x = 1;\n");
	git(root, "add", ".");
	git(root, "commit", "-qm", "delivery");
	return { root, commit: git(root, "rev-parse", "HEAD").trim() };
}

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("readLaneDeliveryIntoIndex", () => {
	test("every index entry carries stat data afterwards", () => {
		const { root, commit } = lane();
		readLaneDeliveryIntoIndex(root, commit);
		const entries = git(root, "ls-files", "--debug").split("\n").filter((line) => line.trim().startsWith("mtime:"));
		expect(entries.length).toBe(2);
		for (const line of entries) expect(line.trim()).not.toBe("mtime: 0:0");
	});

	test("leaves no tracked file unstaged for a no-refresh snapshot", () => {
		const { root, commit } = lane();
		readLaneDeliveryIntoIndex(root, commit);
		expect(unstaged(root)).toBe("");
	});

	test("still reports a real unstaged edit and an unrelated dirty file", () => {
		const { root, commit } = lane();
		readLaneDeliveryIntoIndex(root, commit);
		writeFileSync(join(root, "out.ts"), "changed\n");
		expect(unstaged(root)).toBe("out.ts");
	});

	test("does not throw when the Lane already has an unstaged edit", () => {
		const { root, commit } = lane();
		writeFileSync(join(root, "out.ts"), "dirty\n");
		expect(() => readLaneDeliveryIntoIndex(root, commit)).not.toThrow();
		expect(unstaged(root)).toBe("out.ts");
	});

	test("refuses a commit that cannot be indexed", () => {
		const { root } = lane();
		expect(() => readLaneDeliveryIntoIndex(root, "0".repeat(40))).toThrow("failed to index Lane delivery");
	});
});
