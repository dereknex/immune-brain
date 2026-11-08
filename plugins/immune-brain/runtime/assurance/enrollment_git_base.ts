import { execFileSync, spawnSync } from "node:child_process";
import { readGitHead } from "../kernel/pi_canary_prepare";

export type EnrollmentGitBase = { state: "committed"; head: string } | { state: "unborn"; branch: string };

function git(root: string, args: string[]): string {
	return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
}

/** Read-only. A missing branch is reported as unborn; a broken existing ref is an error. */
export function inspectEnrollmentGitBase(root: string): EnrollmentGitBase {
	if (git(root, ["rev-parse", "--is-inside-work-tree"]) !== "true")
		throw new Error("Enrollment requires a Git working tree");
	try { return { state: "committed", head: readGitHead(root) }; } catch { /* Inspect the unborn case below. */ }
	const branch = git(root, ["symbolic-ref", "--no-recurse", "HEAD"]);
	if (!branch.startsWith("refs/heads/")) throw new Error("Enrollment HEAD must name a local branch");
	const ref = spawnSync("git", ["show-ref", "--verify", "--quiet", branch], { cwd: root });
	const symbolic = spawnSync("git", ["symbolic-ref", "-q", branch], { cwd: root });
	if (ref.status !== 1 || symbolic.status !== 1)
		throw new Error("Enrollment Git HEAD is invalid; only an absent branch is read as unborn");
	return { state: "unborn", branch };
}
