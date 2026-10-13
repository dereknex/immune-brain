// The one owner of every commit the runtime makes on the user's behalf for a
// workflow precondition. A caller passes the exact repository-relative paths
// and a subject; this module never derives paths. It commits only the listed
// paths that are dirty, leaves every other index entry and worktree file
// byte-identical, runs Git hooks normally, and never pushes, amends, switches
// branch or writes Git config.
import { execFileSync, spawnSync } from "node:child_process";
import { lstatSync, realpathSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";

export type WorkflowCommitResult =
	| { committed: false }
	| { committed: true; commit: string; paths: string[] };

export interface WorkflowCommitInput {
	/** Repository-relative, slash-separated file paths. Clean paths are skipped. */
	paths: readonly string[];
	subject: string;
	signal?: AbortSignal;
}

/**
 * Commit identity for a runtime-made commit: the existing environment, then the
 * repository or global config, then the automation fallback. Never a config write.
 */
export function identityEnv(root: string): NodeJS.ProcessEnv {
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

function gitFailure(args: readonly string[], error: unknown): Error {
	const output = (key: "stderr" | "stdout"): string => {
		const value = typeof error === "object" && error !== null ? (error as Record<string, unknown>)[key] : undefined;
		return typeof value === "string" ? value.trim() : Buffer.isBuffer(value) ? value.toString("utf8").trim() : "";
	};
	const detail = output("stderr") || output("stdout") || (error instanceof Error ? error.message : String(error));
	return new Error(`git ${args[0]} failed: ${detail}`);
}

/** Listed paths are literal: no pathspec magic and no glob can widen the list. */
function git(root: string, args: string[], env: NodeJS.ProcessEnv = process.env): string {
	try {
		return execFileSync("git", args, {
			cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
			env: { ...env, GIT_LITERAL_PATHSPECS: "1" },
		});
	} catch (error) {
		throw gitFailure(args, error);
	}
}

const splitNull = (output: string): string[] => output.split("\0").filter((entry) => entry.length > 0);

function assertListedPath(root: string, path: string): void {
	const parts = path.split("/");
	if (path.length === 0 || path.includes("\0") || path.includes("\\") || isAbsolute(path)
		|| parts.some((part) => part === "" || part === "." || part === ".." || part === ".git"))
		throw new Error(`automatic commit refuses a path outside the repository: ${JSON.stringify(path)}`);
	// A directory component that is a symbolic link would let the path leave the
	// repository. The final component may be a link: Git records the link itself.
	let current = root;
	for (const part of parts.slice(0, -1)) {
		current = join(current, part);
		let stat;
		try { stat = lstatSync(current); } catch { return; }
		if (stat.isSymbolicLink())
			throw new Error(`automatic commit refuses a path through a symbolic link: ${path}`);
	}
}

/**
 * Commit exactly the listed paths that differ from HEAD, in one commit.
 * Requires a committed HEAD. Throws with Git's own message when the commit is
 * refused (a hook, identity, a lock); nothing is retried and no hook is bypassed.
 */
export function commitWorkflowPaths(projectRoot: string, input: WorkflowCommitInput): WorkflowCommitResult {
	const root = realpathSync(resolve(projectRoot));
	const listed = [...new Set(input.paths)].sort();
	if (listed.length === 0) return { committed: false };
	for (const path of listed) assertListedPath(root, path);
	if (!/^[^\r\n]+$/.test(input.subject)) throw new Error("automatic commit requires a one-line subject");
	input.signal?.throwIfAborted();

	const toplevel = git(root, ["rev-parse", "--show-toplevel"]).trim();
	if (realpathSync(resolve(toplevel)) !== root)
		throw new Error("automatic commit requires the repository root as the project root");
	git(root, ["rev-parse", "--verify", "--quiet", "HEAD^{commit}"]);

	if (splitNull(git(root, ["ls-files", "--unmerged", "-z"])).length > 0)
		throw new Error("automatic commit refuses an unmerged index; resolve the merge first");
	// `ls-files -v` tags: lowercase is assume-unchanged, `S` is skip-worktree.
	// Either hides worktree content from the commit, so the commit would not
	// contain what the precondition inspected.
	const flagged = splitNull(git(root, ["ls-files", "-v", "-z", "--", ...listed]))
		.filter((entry) => /^[a-zS] /.test(entry))
		.map((entry) => entry.slice(2));
	if (flagged.length > 0)
		throw new Error(`automatic commit refuses assume-unchanged or skip-worktree paths: ${flagged.join(", ")}`);

	const status = splitNull(git(root, ["status", "--porcelain=v1", "-z", "--no-renames", "--untracked-files=all", "--", ...listed]));
	const wanted = new Set(listed);
	const dirty: string[] = [];
	const untracked: string[] = [];
	for (const entry of status) {
		const path = entry.slice(3);
		// A listed directory would report files beneath it; only exact paths count.
		if (!wanted.has(path)) throw new Error(`automatic commit requires file paths, not a directory: ${path}`);
		if (!dirty.includes(path)) dirty.push(path);
		if (entry.startsWith("??")) untracked.push(path);
	}
	if (dirty.length === 0) return { committed: false };
	dirty.sort();

	input.signal?.throwIfAborted();
	const before = git(root, ["rev-parse", "HEAD"]).trim();
	if (untracked.length > 0) git(root, ["add", "--", ...untracked]);
	try {
		git(root, ["commit", "--quiet", "--only", "-m", input.subject, "--", ...dirty], identityEnv(root));
	} catch (error) {
		// Put the paths this call staged back to untracked; a failed commit leaves
		// no trace in the index.
		if (untracked.length > 0 && git(root, ["rev-parse", "HEAD"]).trim() === before) {
			try { git(root, ["reset", "--quiet", "HEAD", "--", ...untracked]); } catch { /* the commit failure is the report */ }
		}
		throw error;
	}
	return { committed: true, commit: git(root, ["rev-parse", "HEAD"]).trim(), paths: dirty };
}
