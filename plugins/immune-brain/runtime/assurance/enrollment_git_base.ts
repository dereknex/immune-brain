import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseTaskIntentV1 } from "../kernel/intent";
import { inspectSpecBinding } from "../kernel/spec_binding";
import { dirtyScopePaths } from "../workspace_scope";
import { commitWorkflowPaths, identityEnv, type WorkflowCommitResult } from "./workflow_autocommit";
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

export function enrollmentGitBaseNotice(base: EnrollmentGitBase): string | undefined {
	return base.state === "unborn"
		? `Git: create an empty initial commit on ${base.branch} before Enrollment; staged files and working tree remain unchanged. This commit remains if later Enrollment fails or is cancelled.`
		: undefined;
}

/** Subject of the commit Enrollment makes for its own preconditions. */
export function enrollmentPreconditionSubject(taskId: string): string {
	return `chore(imm): commit Enrollment preconditions for ${taskId}`;
}

/**
 * The paths Enrollment commits for `taskId`, empty when no precondition would
 * fail. Two states fail Enrollment: a dirty file inside `scope_hint` and an
 * untracked TaskIntent. When either holds, the set is those paths plus the
 * task's own TaskIntent and the Spec its binding names; a staged TaskIntent
 * over a clean scope fails nothing and yields no commit. The TaskIntent is
 * read from the worktree file, tracked or not. Returns null when no set can
 * be derived (no sidecar, an invalid one, an unborn HEAD); the ordinary
 * Enrollment checks then report that condition themselves.
 */
export function enrollmentCommittablePaths(root: string, taskId: string): string[] | null {
	if (!/^[a-z0-9][a-z0-9-]*$/.test(taskId)) return null;
	const intentPath = `docs/plans/${taskId}.intent.json`;
	try {
		if (inspectEnrollmentGitBase(root).state !== "committed") return null;
		const intent = parseTaskIntentV1(JSON.parse(readFileSync(join(root, intentPath), "utf8")));
		if (intent.task_id !== taskId) return null;
		const dirtyScope = dirtyScopePaths(root, intent.scope_hint, taskId);
		const untrackedIntent = spawnSync("git", ["ls-files", "--error-unmatch", "--", intentPath], { cwd: root }).status === 1;
		if (dirtyScope.length === 0 && !untrackedIntent) return [];
		const binding = inspectSpecBinding(intent);
		return [...new Set([intentPath, ...(binding.ok && binding.binding ? [binding.binding.active] : []), ...dirtyScope])];
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

/**
 * Commit the Enrollment committable set when a precondition would fail, so the
 * preparation that follows binds the resulting HEAD. A clean set makes no
 * commit, and neither does an Enrollment an owner check would refuse anyway:
 * an owned workspace keeps its owner's undelivered work uncommitted. A refused
 * commit throws with Git's message.
 */
export function commitEnrollmentPreconditions(root: string, taskId: string, signal?: AbortSignal): WorkflowCommitResult {
	const paths = enrollmentCommittablePaths(root, taskId);
	if (!paths || paths.length === 0 || !freshEnrollmentAdmitted(root, taskId)) return { committed: false };
	return commitWorkflowPaths(root, { paths, subject: enrollmentPreconditionSubject(taskId), signal });
}

/** A preparation's owner facts, without the fields a new Git base legitimately moves. */
const withoutGit = ({ digest, git_base_head, git_error, ...owners }: PiCanaryPreparation) => owners;

/**
 * Unborn-HEAD path only, called after `initializeEnrollmentGitBase`: the scope
 * could not be compared with an unborn HEAD, so commit it now that a base
 * exists. The re-preparation must equal the confirmed one in everything but
 * the Git base, exactly as the empty base commit requires; a TaskIntent or
 * owner changed while the commit ran is refused, not enrolled.
 */
export function commitUnbornEnrollmentPreconditions(
	root: string, input: PiCanaryPrepareInput, confirmed: PiCanaryPreparation, signal?: AbortSignal,
): { result: WorkflowCommitResult; preparation: PiCanaryPreparation } {
	const result = commitEnrollmentPreconditions(root, input.task_id, signal);
	if (!result.committed) return { result, preparation: confirmed };
	const current = preparePiCanary(root, input);
	if (current.git_base_head !== result.commit || JSON.stringify(withoutGit(current)) !== JSON.stringify(withoutGit(confirmed)))
		throw new Error(`Workspace changed during the Enrollment precondition commit; retry Enrollment${preconditionCommitNote(result)}`);
	return { result, preparation: current };
}

/** Suffix naming a precondition commit that outlives a failed or declined Enrollment. */
export function preconditionCommitNote(result: WorkflowCommitResult): string {
	return result.committed ? `; Enrollment precondition commit ${result.commit} remains` : "";
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
