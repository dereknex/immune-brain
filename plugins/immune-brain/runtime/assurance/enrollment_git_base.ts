import { execFileSync, spawnSync } from "node:child_process";
import { preparePiCanary, readGitHead, revalidatePiCanary, type PiCanaryPreparation, type PiCanaryPrepareInput } from "../kernel/pi_canary_prepare";
import { withKernelStoreLock } from "../kernel/storage";

export type EnrollmentGitBase = { state: "committed"; head: string } | { state: "unborn"; branch: string };

function git(root: string, args: string[], input?: string, env = process.env): string {
	return execFileSync("git", args, { cwd: root, encoding: "utf8", input, env, stdio: ["pipe", "pipe", "pipe"] }).trim();
}

/** Read-only. A missing branch is bootstrap-able; a broken existing ref is not. */
export function inspectEnrollmentGitBase(root: string): EnrollmentGitBase {
	if (git(root, ["rev-parse", "--is-inside-work-tree"]) !== "true")
		throw new Error("Enrollment requires a Git working tree");
	try { return { state: "committed", head: readGitHead(root) }; } catch { /* Inspect the unborn case below. */ }
	const branch = git(root, ["symbolic-ref", "--no-recurse", "HEAD"]);
	if (!branch.startsWith("refs/heads/")) throw new Error("Enrollment HEAD must name a local branch");
	const ref = spawnSync("git", ["show-ref", "--verify", "--quiet", branch], { cwd: root });
	const symbolic = spawnSync("git", ["symbolic-ref", "-q", branch], { cwd: root });
	if (ref.status !== 1 || symbolic.status !== 1)
		throw new Error("Enrollment Git HEAD is invalid; only an absent branch can be initialized");
	return { state: "unborn", branch };
}

export function enrollmentGitBaseNotice(base: EnrollmentGitBase): string | undefined {
	return base.state === "unborn"
		? `Git: create an empty initial commit on ${base.branch} before Enrollment; staged files and working tree remain unchanged. This commit remains if later Enrollment fails or is cancelled.`
		: undefined;
}

function identityEnv(root: string): NodeJS.ProcessEnv {
	const configured = (key: string): string => {
		const result = spawnSync("git", ["config", "--get", key], { cwd: root, encoding: "utf8" });
		if (result.status !== 0 && result.status !== 1) throw new Error(`Cannot read Git identity: ${key}`);
		return result.stdout?.trim() ?? "";
	};
	const name = configured("user.name") || "Immune-Brain Enrollment";
	const email = configured("user.email") || "enrollment@immune-brain.local";
	return { ...process.env,
		GIT_AUTHOR_NAME: process.env.GIT_AUTHOR_NAME || name, GIT_AUTHOR_EMAIL: process.env.GIT_AUTHOR_EMAIL || email,
		GIT_COMMITTER_NAME: process.env.GIT_COMMITTER_NAME || name, GIT_COMMITTER_EMAIL: process.env.GIT_COMMITTER_EMAIL || email,
	};
}

/** Called only after native confirmation. Never stages files or writes Git config. */
export function initializeEnrollmentGitBase(
	root: string, input: PiCanaryPrepareInput, previous: PiCanaryPreparation,
	base: EnrollmentGitBase, signal?: AbortSignal,
): PiCanaryPreparation {
	const assertUnchanged = () => {
		signal?.throwIfAborted();
		if (!revalidatePiCanary(root, input, previous).unchanged
			|| JSON.stringify(inspectEnrollmentGitBase(root)) !== JSON.stringify(base))
			throw new Error("Workspace or Git branch changed after confirmation; retry Enrollment");
	};
	assertUnchanged();
	if (base.state === "committed") return previous;
	return withKernelStoreLock(root, () => {
		// CAS the captured branch itself, never HEAD: a concurrent symbolic HEAD
		// switch must not redirect the write to another branch. Recheck HEAD after
		// the write and report any created base if the workspace changed.
		let created: string | undefined;
		try {
			assertUnchanged();
			if (!previous.intent || previous.backend_claim.present || previous.task_record_v3?.present || previous.workspace.current_working !== null)
				throw new Error("Empty Git base initialization requires an unowned workspace and a tracked TaskIntent");
			const tree = git(root, ["hash-object", "-t", "tree", "-w", "--stdin"], "");
			const commit = git(root, ["commit-tree", tree, "-m", "chore: initialize empty Enrollment base"], undefined, identityEnv(root));
			assertUnchanged();
			git(root, ["update-ref", "--no-deref", base.branch, commit, "0".repeat(commit.length)]);
			created = commit;
			const current = preparePiCanary(root, input);
			const withoutGit = ({ digest, git_base_head, git_error, ...owners }: PiCanaryPreparation) => owners;
			if (git(root, ["symbolic-ref", "--no-recurse", "HEAD"]) !== base.branch || current.git_base_head !== commit
				|| JSON.stringify(withoutGit(current)) !== JSON.stringify(withoutGit(previous)))
				throw new Error("Workspace changed during empty Git base initialization; retry Enrollment");
			return current;
		} catch (error) {
			if (created) throw new Error(`${error instanceof Error ? error.message : String(error)}; empty initial commit ${created} remains`);
			throw error;
		}
	});
}
