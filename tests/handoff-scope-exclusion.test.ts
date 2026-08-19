import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { captureGitWorkspaceSnapshot } from "../plugins/immune-brain/runtime/workspace_scope";

let root: string;

function run(args: string[]): void {
	const result = spawnSync("git", ["-C", root, ...args], { encoding: "utf8" });
	if (result.status !== 0) throw new Error(result.stderr);
}

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "imm-handoff-scope-"));
	run(["init", "-q"]);
	run(["config", "user.email", "test@example.com"]);
	run(["config", "user.name", "Test"]);
	writeFileSync(join(root, "seed.txt"), "seed\n");
	run(["add", "-A"]);
	run(["commit", "-qm", "seed"]);
});

afterEach(() => {
	rmSync(root, { recursive: true, force: true });
});

describe("HANDOFF.md scope exclusion", () => {
	it("keeps a runtime-written HANDOFF.md out of the dirty file set", () => {
		writeFileSync(join(root, "HANDOFF.md"), "# Immune-Brain Handoff\n");

		const snapshot = captureGitWorkspaceSnapshot(root);

		expect(snapshot).not.toBeNull();
		expect(Object.keys(snapshot!.dirty_files)).not.toContain("HANDOFF.md");
	});

	it("still reports ordinary source edits as dirty", () => {
		writeFileSync(join(root, "seed.txt"), "changed\n");

		const snapshot = captureGitWorkspaceSnapshot(root);

		expect(Object.keys(snapshot!.dirty_files)).toContain("seed.txt");
	});

	it("does not exclude a HANDOFF.md nested under another directory", () => {
		run(["config", "core.excludesFile", "/dev/null"]);
		writeFileSync(join(root, "seed.txt"), "changed\n");
		spawnSync("mkdir", ["-p", join(root, "docs")]);
		writeFileSync(join(root, "docs", "HANDOFF.md"), "not the root artifact\n");

		const snapshot = captureGitWorkspaceSnapshot(root);

		expect(Object.keys(snapshot!.dirty_files)).toContain("docs/HANDOFF.md");
	});
});
