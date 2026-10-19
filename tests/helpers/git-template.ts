import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// One template repository per test process, copied into each fixture root
// (Spec branch-boundary D2): six git subprocesses per fixture made concurrent
// runs exceed their timeouts. The template never holds worktrees, whose
// metadata stores absolute paths.
let template: { root: string; head: string } | undefined;
let initCount = 0;

function initTemplate(): { root: string; head: string } {
	const root = mkdtempSync(join(tmpdir(), "imm-git-template-"));
	execFileSync("git", ["init", "-q", "-b", "main"], { cwd: root });
	execFileSync("git", ["config", "user.name", "Test"], { cwd: root });
	execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: root });
	mkdirSync(join(root, ".imm", "state"), { recursive: true });
	writeFileSync(join(root, ".gitignore"), ".imm/state/\n");
	execFileSync("git", ["add", "-A"], { cwd: root });
	execFileSync("git", ["commit", "-q", "-m", "init"], { cwd: root });
	const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
	initCount += 1;
	process.once("exit", () => rmSync(root, { recursive: true, force: true }));
	return { root, head };
}

/** How many times this process initialized the template; stays 1 after first use. */
export function gitTemplateInitCount(): number {
	return initCount;
}

/**
 * Copy the template repository into an existing empty `root` and return its HEAD.
 * The index is refreshed because copied files carry new inodes.
 */
export function copyGitTemplate(root: string): string {
	template ??= initTemplate();
	cpSync(template.root, root, { recursive: true, preserveTimestamps: true });
	execFileSync("git", ["update-index", "-q", "--refresh"], { cwd: root });
	return template.head;
}
