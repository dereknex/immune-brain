import { execFileSync, spawnSync } from "node:child_process";
import { observeEnrollmentTaskIntent } from "../kernel/intent";
import { inspectSpecBinding } from "../kernel/spec_binding";
import { dirtyScopePaths } from "../workspace_scope";
import { commitWorkflowPaths, identityEnv, type WorkflowCommitResult } from "./workflow_autocommit";
import { readGitIntegrationPreference } from "../git_integration_preference";
import { preparePiCanary, readGitHead, revalidatePiCanary, type PiCanaryPreparation, type PiCanaryPrepareInput } from "../kernel/pi_canary_prepare";
import { reconcileKernelAuthority, withKernelStoreLock } from "../kernel/storage";

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

/** With `root`, the notice also says what happens to in-scope changes under the Git integration preference. */
export function enrollmentGitBaseNotice(base: EnrollmentGitBase, root?: string): string | undefined {
	if (base.state !== "unborn") return undefined;
	const notice = `Git: create an empty initial commit on ${base.branch} before Enrollment; staged files and working tree remain unchanged. This commit remains if later Enrollment fails or is cancelled.`;
	if (root === undefined) return notice;
	return readGitIntegrationPreference(root).mode === "manual"
		? `${notice} In-scope staged and untracked changes become task work without a commit (Git integration: manual).`
		: `${notice} In-scope staged and untracked changes are then committed on top of it (Git integration: auto).`;
}

/** Subject of the commit Enrollment makes for its own preconditions. */
export function enrollmentPreconditionSubject(taskId: string): string {
	return `chore(imm): commit Enrollment preconditions for ${taskId}`;
}

/**
 * The paths Enrollment commits for `taskId`, empty when no precondition would
 * fail. On a committed HEAD an untracked TaskIntent is the one failing state:
 * the set is then the task's own TaskIntent and the Spec its binding names.
 * In-scope dirt is not committed on a committed HEAD — the confirmed
 * Enrollment gate claims it as task work (host-owned-environment D8), and a
 * staged TaskIntent over a clean scope fails nothing and yields no commit. The
 * `unbornScope` form is the exception: there the empty root commit is what
 * makes the Planner's staged and untracked in-scope edits dirty, and the
 * disclosure could not list them because no HEAD existed to compare against,
 * so the commit carries them. The TaskIntent is read from the worktree file,
 * tracked or not. Returns null when no set can be derived (no sidecar, an
 * invalid one, an unborn HEAD); the ordinary Enrollment checks then report
 * that condition themselves.
 */
export function enrollmentCommittablePaths(root: string, taskId: string, unbornScope = false): string[] | null {
	const intentPath = `docs/plans/${taskId}.intent.json`;
	try {
		if (inspectEnrollmentGitBase(root).state !== "committed") return null;
		const { intent } = observeEnrollmentTaskIntent(root, taskId);
		const binding = inspectSpecBinding(intent);
		if (!binding.ok) return null;
		const dirtyScope = unbornScope ? dirtyScopePaths(root, intent.scope_hint, taskId) : [];
		const untrackedIntent = spawnSync("git", ["ls-files", "--error-unmatch", "--", intentPath], { cwd: root }).status === 1;
		if (dirtyScope.length === 0 && !untrackedIntent) return [];
		return [...new Set([intentPath, ...(binding.binding ? [binding.binding.active] : []), ...dirtyScope])];
	} catch {
		return null;
	}
}

/**
 * Read-only. True when no Kernel owner would refuse a fresh Enrollment of
 * `taskId`: the authority projection is unowned (or carries only historical
 * audit evidence with no local run), and no backend claim, TaskRecord or
 * workspace owner exists. An unreadable owner state does not admit.
 */
function freshEnrollmentAdmitted(root: string, taskId: string): boolean {
	try {
		const authority = reconcileKernelAuthority(root, taskId);
		if (authority.state !== "unowned" && !(authority.state === "terminal_owner" && authority.owner_run_id === null))
			return false;
		const owners = preparePiCanary(root, { task_id: taskId, now: new Date().toISOString() });
		return !owners.backend_claim.present && !owners.task_record_v3?.present && owners.workspace.current_working === null;
	} catch {
		return false;
	}
}

/** A precondition commit, or under `Git integration: manual` the paths staged instead. */
export type EnrollmentPreconditionResult = WorkflowCommitResult | { committed: false; staged: string[] };

/** Stage exactly the listed paths; no pathspec magic can widen the list. */
function stagePaths(root: string, paths: readonly string[]): void {
	// git add can stage other paths before rejecting an ignored Spec; check the whole set first.
	const ignored = spawnSync("git", ["check-ignore", "-z", "--stdin"], {
		cwd: root, encoding: "utf8", input: `${paths.join("\0")}\0`,
	});
	if (ignored.status === 0)
		throw new Error(`enrollment_precondition_ignored_path: ${ignored.stdout.split("\0").filter(Boolean).join(", ")}; adjust Git ignore rules or explicitly track these planning files before retrying Enrollment`);
	if (ignored.status !== 1)
		throw new Error(`enrollment_precondition_ignore_check_failed: ${ignored.error?.message ?? ignored.stderr.trim()}`);
	execFileSync("git", ["add", "--", ...paths], {
		cwd: root, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, GIT_LITERAL_PATHSPECS: "1" },
	});
}

/**
 * Satisfy the Enrollment preconditions when one would fail, so the preparation
 * that follows binds the resulting state. Under `Git integration: auto` the
 * committable set is committed; under `manual` (the default) the TaskIntent and
 * its bound Spec are staged instead, which is all tracking requires, and no
 * commit is written. A clean set changes nothing, and neither does an
 * Enrollment an owner check would refuse anyway: an owned workspace keeps its
 * owner's undelivered work untouched. A refused commit throws with Git's message.
 */
export function commitEnrollmentPreconditions(root: string, taskId: string, signal?: AbortSignal, unbornScope = false): EnrollmentPreconditionResult {
	return withKernelStoreLock(root, () => {
		const paths = enrollmentCommittablePaths(root, taskId, unbornScope);
		if (!paths || paths.length === 0 || !freshEnrollmentAdmitted(root, taskId)) return { committed: false };
		if (readGitIntegrationPreference(root).mode === "manual") {
			signal?.throwIfAborted();
			// The unborn form's extra paths are in-scope task work: they are claimed, not staged.
			const staged = unbornScope ? [] : paths;
			if (staged.length > 0) stagePaths(root, staged);
			return { committed: false, staged };
		}
		return commitWorkflowPaths(root, { paths, subject: enrollmentPreconditionSubject(taskId), signal });
	});
}

/** A preparation's owner facts, without the fields a new Git base legitimately moves. */
const withoutGit = ({ digest, git_base_head, git_error, ...owners }: PiCanaryPreparation) => owners;

/**
 * Unborn-HEAD path only, called after `initializeEnrollmentGitBase`: the scope
 * could not be compared with an unborn HEAD. Under `Git integration: auto` it
 * is committed now that a base exists, in-scope edits included. Under `manual`
 * nothing is committed: the in-scope staged and untracked changes are returned
 * as `claimed_scope_paths`, which the Host adds to the paths its confirmed gate
 * disclosed, so they become task work exactly as the gate's notice said. The
 * re-preparation after a commit must equal the confirmed one in everything but
 * the Git base, exactly as the empty base commit requires; a TaskIntent or
 * owner changed while the commit ran is refused, not enrolled.
 */
export function commitUnbornEnrollmentPreconditions(
	root: string, input: PiCanaryPrepareInput, confirmed: PiCanaryPreparation, signal?: AbortSignal,
): { result: EnrollmentPreconditionResult; preparation: PiCanaryPreparation; claimed_scope_paths: string[] } {
	if (readGitIntegrationPreference(root).mode === "manual") {
		signal?.throwIfAborted();
		let claimed: string[] = [];
		try {
			if (freshEnrollmentAdmitted(root, input.task_id))
				claimed = dirtyScopePaths(root, observeEnrollmentTaskIntent(root, input.task_id).intent.scope_hint, input.task_id);
		} catch {
			// The ordinary Enrollment checks report an unreadable scope themselves.
		}
		return { result: { committed: false, staged: [] }, preparation: confirmed, claimed_scope_paths: claimed };
	}
	const result = commitEnrollmentPreconditions(root, input.task_id, signal, true);
	if (!result.committed) return { result, preparation: confirmed, claimed_scope_paths: [] };
	const current = preparePiCanary(root, input);
	if (current.git_base_head !== result.commit || JSON.stringify(withoutGit(current)) !== JSON.stringify(withoutGit(confirmed)))
		throw new Error(`Workspace changed during the Enrollment precondition commit; retry Enrollment${preconditionCommitNote(result)}`);
	return { result, preparation: current, claimed_scope_paths: [] };
}

/** Suffix naming a precondition commit, or staged preconditions, that outlive a failed or declined Enrollment. */
export function preconditionCommitNote(result: EnrollmentPreconditionResult): string {
	if (result.committed) return `; Enrollment precondition commit ${result.commit} remains`;
	return "staged" in result && result.staged.length > 0
		? `; Enrollment staged ${result.staged.join(", ")} without committing (Git integration: manual); they remain staged`
		: "";
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
