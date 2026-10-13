// The one owner of every commit the runtime makes on the user's behalf for a
// workflow precondition. A caller passes the exact repository-relative paths
// and a subject; this module never derives paths. It commits only the listed
// paths that are dirty, leaves every other index entry and worktree file
// byte-identical, runs Git hooks normally, and never pushes, amends, switches
// branch or writes Git config.
import { execFileSync, spawnSync } from "node:child_process";
import { accessSync, chmodSync, constants, lstatSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
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
	return new Error(`git ${args[0] === "-c" ? args[2] : args[0]} failed: ${detail}`);
}

/** Listed paths are literal: no pathspec magic and no glob can widen the list. */
function git(root: string, args: string[], env: NodeJS.ProcessEnv = process.env): string {
	try {
		return execFileSync("git", args, {
			cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
			env: { ...env, GIT_LITERAL_PATHSPECS: "1", GIT_GLOB_PATHSPECS: undefined, GIT_NOGLOB_PATHSPECS: undefined, GIT_ICASE_PATHSPECS: undefined },
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

/** Guard the final commit tree at Git's prepared ref transaction, after all commit hooks. */
function commitWithPathGuard(root: string, dirty: string[], before: string, subject: string): void {
	// reference-transaction was introduced in Git 2.29; an older Git cannot enforce this boundary.
	const version = git(root, ["--version"]).match(/git version (\d+)\.(\d+)/);
	if (!version || Number(version[1]) < 2 || (Number(version[1]) === 2 && Number(version[2]) < 29))
		throw new Error("automatic commit requires Git 2.29 or newer for its ref transaction guard");
	const targetRef = git(root, ["rev-parse", "--symbolic-full-name", "HEAD"]).trim();
	const originalHooks = resolve(root, git(root, ["rev-parse", "--git-path", "hooks"]).trim());
	const temporary = mkdtempSync(join(tmpdir(), "imm-commit-hooks-"));
	const hooks = join(temporary, "hooks");
	try {
		mkdirSync(hooks);
		let entries: string[] = [];
		try { entries = readdirSync(originalHooks); } catch (error) {
			if (!["ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
		}
		const quote = (path: string) => `'${path.replaceAll("'", "'\\''")}'`;
		// Restore the caller's hook environment, excluding our command-local pathspec/config overrides.
		const hookEnvironment = Object.fromEntries([
			"GIT_LITERAL_PATHSPECS", "GIT_GLOB_PATHSPECS", "GIT_NOGLOB_PATHSPECS", "GIT_ICASE_PATHSPECS", "GIT_CONFIG_PARAMETERS",
		].map((key) => [key, process.env[key] ?? null]));
		const restoreEnvironment = Object.entries(hookEnvironment).map(([key, value]) =>
			value === null ? `unset ${key}` : `export ${key}=${quote(value)}`,
		).join("\n");
		for (const name of entries) {
			if (name === "reference-transaction") continue;
			const original = join(originalHooks, name);
			try { accessSync(original, constants.X_OK); } catch (error) {
				if (["ENOENT", "ENOTDIR", "EACCES"].includes((error as NodeJS.ErrnoException).code ?? "")) continue;
				throw error;
			}
			const forwarding = join(hooks, name);
			writeFileSync(forwarding, `#!/bin/sh\n${restoreEnvironment}\nexec ${quote(original)} "$@"\n`);
			chmodSync(forwarding, 0o755);
		}
		const originalRefHook = join(originalHooks, "reference-transaction");
		let executableRefHook: string | null = null;
		try { accessSync(originalRefHook, constants.X_OK); executableRefHook = originalRefHook; } catch (error) {
			if (!["ENOENT", "ENOTDIR", "EACCES"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
		}
		const guard = join(temporary, "guard.cjs");
		writeFileSync(guard, `const {execFileSync, spawnSync} = require("node:child_process");
const {readFileSync} = require("node:fs");
const input = readFileSync(0);
const original = ${JSON.stringify(executableRefHook)};
const originalEnv = { ...process.env };
for (const [key, value] of Object.entries(${JSON.stringify(hookEnvironment)})) {
  if (value === null) delete originalEnv[key]; else originalEnv[key] = value;
}
if (original) {
  const result = spawnSync(original, process.argv.slice(2), {env: originalEnv, input, stdio: ["pipe", "inherit", "inherit"]});
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
if (process.argv[2] === "prepared") {
  const git = (...args) => execFileSync("git", args, {cwd: ${JSON.stringify(root)}, encoding: "utf8"});
  for (const line of input.toString("utf8").trim().split("\\n")) {
    const [old, next, ref] = line.split(" ");
    if (ref !== ${JSON.stringify(targetRef)} && ref !== "HEAD") continue;
    const parents = git("rev-list", "--parents", "-n", "1", next).trim().split(" ");
    const paths = git("diff", "--no-renames", "--name-only", "-z", old, next).split("\\0").filter(Boolean);
    const allowed = new Set(${JSON.stringify(dirty)});
    if (old !== ${JSON.stringify(before)} || parents.length !== 2 || parents[1] !== old
        || paths.length !== allowed.size || paths.some(path => !allowed.has(path))
        || git("show", "-s", "--format=%s", next).trimEnd() !== ${JSON.stringify(subject)}) {
      console.error("automatic commit refuses hook changes to the listed paths, parent or subject");
      process.exit(1);
    }
  }
}
`);
		const hook = join(hooks, "reference-transaction");
		writeFileSync(hook, `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(guard)} "$@"\n`);
		chmodSync(hook, 0o755);
		// Command-local configuration leaves repository/global config unchanged; all original hooks still run.
		git(root, ["-c", `core.hooksPath=${hooks}`, "commit", "--quiet", "--only", "-m", subject, "--", ...dirty], identityEnv(root));
	} finally {
		rmSync(temporary, { recursive: true, force: true });
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
	// --only commits worktree content; index-only changes whose worktree equals HEAD stay staged.
	const worktreeChanges = new Set(splitNull(git(root, ["diff", "--no-renames", "--name-only", "-z", "HEAD", "--", ...listed])));
	const wanted = new Set(listed);
	const dirty: string[] = [];
	const untracked: string[] = [];
	for (const entry of status) {
		const path = entry.slice(3);
		// A listed directory would report files beneath it; only exact paths count.
		if (!wanted.has(path)) throw new Error(`automatic commit requires file paths, not a directory: ${path}`);
		if (!entry.startsWith("??") && !worktreeChanges.has(path)) continue;
		if (!dirty.includes(path)) dirty.push(path);
		if (entry.startsWith("??")) untracked.push(path);
	}
	if (dirty.length === 0) return { committed: false };
	dirty.sort();

	input.signal?.throwIfAborted();
	const before = git(root, ["rev-parse", "HEAD"]).trim();
	if (untracked.length > 0) git(root, ["add", "--", ...untracked]);
	try {
		commitWithPathGuard(root, dirty, before, input.subject);
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
