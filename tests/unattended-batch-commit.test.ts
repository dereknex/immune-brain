import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	runBatchGitPreflight,
	commitBatchChild,
	lookupBatchCommit,
} from "../plugins/immune-brain/runtime/unattended/batch_git";
import {
	startBatch,
	resumeBatch,
	type BatchRunnerKernelPort,
} from "../plugins/immune-brain/runtime/unattended/batch_runner";
import { readBatchRunState } from "../plugins/immune-brain/runtime/unattended/batch_state";
import {
	createBatchAuthorityRegistry,
	computeBatchPlanDigest,
} from "../plugins/immune-brain/runtime/kernel/batch_authority";
import type { BatchPlanChild } from "../plugins/immune-brain/runtime/unattended/types";
import { readAuditTaskPair } from "../plugins/immune-brain/runtime/kernel/storage";
import { canonicalIntentHash, parseTaskIntentV1 } from "../plugins/immune-brain/runtime/kernel/intent";

const CONFIRMATION_TIME = "2026-01-01T00:00:00.000Z";
const FAR_FUTURE = "2099-01-01T00:00:00.000Z";

function git(root: string, args: string[]): string {
	const res = spawnSync("git", ["-C", root, ...args], {
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
		env: {
			...process.env,
			GIT_AUTHOR_NAME: "Test",
			GIT_AUTHOR_EMAIL: "test@example.com",
			GIT_COMMITTER_NAME: "Test",
			GIT_COMMITTER_EMAIL: "test@example.com",
		},
	});
	if (res.status !== 0) {
		throw new Error(`git ${args.join(" ")} failed: ${res.stderr || res.stdout}`);
	}
	return res.stdout.trim();
}

function initGitRepo(): { root: string; baseHead: string } {
	const root = mkdtempSync(join(tmpdir(), "batch-commit-test-"));
	git(root, ["init", "-b", "main"]);
	git(root, ["config", "user.name", "Test"]);
	git(root, ["config", "user.email", "test@example.com"]);

	writeFileSync(join(root, ".gitignore"), ".imm/state/\n");
	git(root, ["add", ".gitignore"]);
	git(root, ["commit", "-m", "initial commit"]);
	const baseHead = git(root, ["rev-parse", "HEAD"]);
	return { root, baseHead };
}

function writeChildAudit(
	root: string,
	taskId: string,
	lifecycle = "done",
	baseHead = "b".repeat(40),
	intentOverride?: Record<string, unknown>,
): void {
	const auditDir = join(root, ".imm", "audit", taskId);
	mkdirSync(auditDir, { recursive: true });
	const rawIntent = intentOverride ?? {
		contract: "assurance_kernel/task_intent/v1",
		task_id: taskId,
		owner: "user",
		goal: `Goal for ${taskId}`,
		scope_hint: [`src/${taskId}.ts`],
		acceptance: [
			{
				id: `acc-${taskId}`,
				assertion: "assert something",
				verification: "bun test",
			},
		],
		risk: "material",
		revision: 1,
	};
	const intent = parseTaskIntentV1(rawIntent);
	const intentHash = canonicalIntentHash(intent);
	const record = {
		contract: "assurance_kernel/task_record/v4",
		task_id: taskId,
		intent_snapshot: intent,
		intent_ref: {
			path: `docs/plans/archive/${taskId}.intent.json`,
			content_hash: intentHash,
		},
		lifecycle,
		artifact_state: "frozen",
		baseline: intentHash,
		git_base_head: baseHead,
		attestations: [],
		findings: [],
		history: [],
	};
	const recordBytes = `${JSON.stringify(record, null, 2)}\n`;
	writeFileSync(join(auditDir, "task-record.json"), recordBytes);
	const recordHash = new Bun.CryptoHasher("sha256").update(recordBytes).digest("hex");
	const proof = {
		contract: "assurance_kernel/task_tombstone/v2",
		task_id: taskId,
		lifecycle_status: "terminal",
		terminal_lifecycle: lifecycle,
		terminal_event_id: `evt-term-${taskId}`,
		final_record_hash: `sha256:${recordHash}`,
		terminalized_at: new Date().toISOString(),
	};
	writeFileSync(join(auditDir, "terminal-proof.json"), `${JSON.stringify(proof, null, 2)}\n`);
}

function writeTaskIntent(
	root: string,
	taskId: string,
	goal: string,
	scopeHint: string[],
): string {
	const plansDir = join(root, "docs", "plans");
	mkdirSync(plansDir, { recursive: true });
	const intentPath = `docs/plans/${taskId}.intent.json`;
	const intent = {
		contract: "assurance_kernel/task_intent/v1",
		task_id: taskId,
		owner: "user",
		goal,
		scope_hint: scopeHint,
		acceptance: [
			{
				id: `acc-${taskId}`,
				assertion: "assert something",
				verification: "bun test",
			},
		],
		risk: "material",
		revision: 1,
	};
	writeFileSync(join(root, intentPath), `${JSON.stringify(intent, null, 2)}\n`);
	return intentPath;
}

describe("acc-batch-branch-preflight", () => {
	let repo: { root: string; baseHead: string };

	beforeEach(() => {
		repo = initGitRepo();
	});

	afterEach(() => {
		rmSync(repo.root, { recursive: true, force: true });
	});

	it("rejects with dirty_working_tree when working tree has modified tracked files", () => {
		writeFileSync(join(repo.root, ".gitignore"), ".imm/state/\n# dirty modification\n");
		const currentBranch = git(repo.root, ["symbolic-ref", "--short", "HEAD"]);

		const res = runBatchGitPreflight({
			root: repo.root,
			initiative_slug: "my-initiative",
			base_head: repo.baseHead,
		});

		expect(res.ok).toBe(false);
		if (!res.ok) {
			expect(res.reason).toBe("dirty_working_tree");
		}
		expect(existsSync(join(repo.root, ".imm", "state", "batches"))).toBe(false);
		expect(git(repo.root, ["symbolic-ref", "--short", "HEAD"])).toBe(currentBranch);
		expect(() => git(repo.root, ["rev-parse", "--verify", "refs/heads/imm/my-initiative"])).toThrow();
	});

	it("rejects with dirty_working_tree when working tree has untracked non-ignored files", () => {
		writeFileSync(join(repo.root, "untracked.txt"), "hello");
		const currentBranch = git(repo.root, ["symbolic-ref", "--short", "HEAD"]);

		const res = runBatchGitPreflight({
			root: repo.root,
			initiative_slug: "my-initiative",
			base_head: repo.baseHead,
		});

		expect(res.ok).toBe(false);
		if (!res.ok) {
			expect(res.reason).toBe("dirty_working_tree");
		}
		expect(existsSync(join(repo.root, ".imm", "state", "batches"))).toBe(false);
		expect(git(repo.root, ["symbolic-ref", "--short", "HEAD"])).toBe(currentBranch);
		expect(() => git(repo.root, ["rev-parse", "--verify", "refs/heads/imm/my-initiative"])).toThrow();
	});

	it("rejects with uncommitted_head when repository has zero commits", () => {
		const emptyDir = mkdtempSync(join(tmpdir(), "empty-git-"));
		try {
			git(emptyDir, ["init", "-b", "main"]);
			const res = runBatchGitPreflight({
				root: emptyDir,
				initiative_slug: "my-initiative",
				base_head: "0".repeat(40),
			});
			expect(res.ok).toBe(false);
			if (!res.ok) {
				expect(res.reason).toBe("uncommitted_head");
			}
			expect(existsSync(join(emptyDir, ".imm", "state", "batches"))).toBe(false);
		} finally {
			rmSync(emptyDir, { recursive: true, force: true });
		}
	});

	it("Finding 2: rejects with dirty_working_tree when repo has status.showUntrackedFiles=no and untracked files exist", () => {
		git(repo.root, ["config", "status.showUntrackedFiles", "no"]);
		writeFileSync(join(repo.root, "hidden-untracked.txt"), "hello");
		const currentBranch = git(repo.root, ["symbolic-ref", "--short", "HEAD"]);

		const res = runBatchGitPreflight({
			root: repo.root,
			initiative_slug: "my-initiative-hidden",
			base_head: repo.baseHead,
		});

		expect(res.ok).toBe(false);
		if (!res.ok) {
			expect(res.reason).toBe("dirty_working_tree");
		}
		expect(existsSync(join(repo.root, ".imm", "state", "batches"))).toBe(false);
		expect(git(repo.root, ["symbolic-ref", "--short", "HEAD"])).toBe(currentBranch);
		expect(() => git(repo.root, ["rev-parse", "--verify", "refs/heads/imm/my-initiative-hidden"])).toThrow();
	});

	it("Finding 2: rejects with dirty_working_tree when repo has assume-unchanged files", () => {
		writeFileSync(join(repo.root, "tracked.txt"), "hello");
		git(repo.root, ["add", "tracked.txt"]);
		git(repo.root, ["commit", "-m", "add tracked"]);
		git(repo.root, ["update-index", "--assume-unchanged", "tracked.txt"]);

		const currentBranch = git(repo.root, ["symbolic-ref", "--short", "HEAD"]);
		const res = runBatchGitPreflight({
			root: repo.root,
			initiative_slug: "my-initiative-assume",
			base_head: git(repo.root, ["rev-parse", "HEAD"]),
		});

		expect(res.ok).toBe(false);
		if (!res.ok) {
			expect(res.reason).toBe("dirty_working_tree");
		}
		expect(existsSync(join(repo.root, ".imm", "state", "batches"))).toBe(false);
		expect(git(repo.root, ["symbolic-ref", "--short", "HEAD"])).toBe(currentBranch);
	});

	it("Finding 1: rejects with dirty_working_tree when repo has combined assume-unchanged and skip-worktree flags (tag s)", () => {
		writeFileSync(join(repo.root, "combined.txt"), "hello");
		git(repo.root, ["add", "combined.txt"]);
		git(repo.root, ["commit", "-m", "add combined"]);
		git(repo.root, ["update-index", "--skip-worktree", "combined.txt"]);
		git(repo.root, ["update-index", "--assume-unchanged", "combined.txt"]);

		const currentBranch = git(repo.root, ["symbolic-ref", "--short", "HEAD"]);
		const res = runBatchGitPreflight({
			root: repo.root,
			initiative_slug: "my-initiative-combined",
			base_head: git(repo.root, ["rev-parse", "HEAD"]),
		});

		expect(res.ok).toBe(false);
		expect(res.reason).toBe("dirty_working_tree");
		expect(existsSync(join(repo.root, ".imm", "state", "batches"))).toBe(false);
		expect(git(repo.root, ["symbolic-ref", "--short", "HEAD"])).toBe(currentBranch);
	});

	it("Finding 5: rejects with not_a_git_repository when root is not a git directory", () => {
		const nonGit = mkdtempSync(join(tmpdir(), "non-git-"));
		try {
			const res = runBatchGitPreflight({
				root: nonGit,
				initiative_slug: "my-initiative",
				base_head: repo.baseHead,
			});
			expect(res.ok).toBe(false);
			if (!res.ok) {
				expect(res.reason).toBe("not_a_git_repository");
			}
			expect(existsSync(join(nonGit, ".imm"))).toBe(false);
		} finally {
			rmSync(nonGit, { recursive: true, force: true });
		}
	});

	it("Finding 5: rejects with not_repository_root when root is a subdirectory of a git repo", () => {
		const subDir = join(repo.root, "sub", "dir");
		mkdirSync(subDir, { recursive: true });
		const res = runBatchGitPreflight({
			root: subDir,
			initiative_slug: "my-initiative",
			base_head: repo.baseHead,
		});
		expect(res.ok).toBe(false);
		if (!res.ok) {
			expect(res.reason).toBe("not_repository_root");
		}
		expect(existsSync(join(subDir, ".imm"))).toBe(false);
	});

	it("Finding 2: post-checkout hook failure is bypassed via core.hooksPath=/dev/null during preflight", () => {
		const hooksDir = join(repo.root, ".git", "hooks");
		mkdirSync(hooksDir, { recursive: true });
		const hookFile = join(hooksDir, "post-checkout");
		writeFileSync(hookFile, "#!/bin/sh\nexit 1\n");
		spawnSync("chmod", ["+x", hookFile]);

		const res = runBatchGitPreflight({
			root: repo.root,
			initiative_slug: "my-initiative-post-checkout",
			base_head: repo.baseHead,
		});

		expect(res.ok).toBe(true);
		if (res.ok) {
			expect(res.branch).toBe("imm/my-initiative-post-checkout");
		}
		expect(git(repo.root, ["symbolic-ref", "--short", "HEAD"])).toBe("imm/my-initiative-post-checkout");
	});

	it("rejects with batch_branch_exists when refs/heads/imm/<initiative-slug> already exists", () => {
		git(repo.root, ["branch", "imm/my-initiative", repo.baseHead]);
		const currentBranch = git(repo.root, ["symbolic-ref", "--short", "HEAD"]);

		const res = runBatchGitPreflight({
			root: repo.root,
			initiative_slug: "my-initiative",
			base_head: repo.baseHead,
		});

		expect(res.ok).toBe(false);
		if (!res.ok) {
			expect(res.reason).toBe("batch_branch_exists");
		}
		expect(git(repo.root, ["symbolic-ref", "--short", "HEAD"])).toBe(currentBranch);
		expect(existsSync(join(repo.root, ".imm", "state", "batches"))).toBe(false);
	});

	it("on passing preflight creates and switches to imm/<initiative-slug> from base_head", () => {
		const res = runBatchGitPreflight({
			root: repo.root,
			initiative_slug: "my-initiative",
			base_head: repo.baseHead,
		});

		expect(res.ok).toBe(true);
		if (res.ok) {
			expect(res.branch).toBe("imm/my-initiative");
		}
		expect(git(repo.root, ["symbolic-ref", "--short", "HEAD"])).toBe("imm/my-initiative");
		expect(git(repo.root, ["rev-parse", "HEAD"])).toBe(repo.baseHead);
	});
});

describe("acc-batch-scope-bounded-commit", () => {
	let repo: { root: string; baseHead: string };

	beforeEach(() => {
		repo = initGitRepo();
		git(repo.root, ["checkout", "-b", "imm/test-initiative", repo.baseHead]);
	});

	afterEach(() => {
		rmSync(repo.root, { recursive: true, force: true });
	});

	it("Finding 2: valid audit fixture passes readAuditTaskPair validation", () => {
		const taskId = "audit-valid";
		writeChildAudit(repo.root, taskId, "done", repo.baseHead);
		const pair = readAuditTaskPair(repo.root, taskId);
		expect(pair).not.toBeNull();
		expect(pair!.record.lifecycle).toBe("done");
		expect(pair!.proof.terminal_lifecycle).toBe("done");
	});

	it("Finding 2: refuses to commit if audit task record or proof is tampered with", async () => {
		const taskId = "task-tampered";
		writeChildAudit(repo.root, taskId, "done", repo.baseHead);

		// Tamper with record bytes so final_record_hash fails
		const recordFile = join(repo.root, ".imm", "audit", taskId, "task-record.json");
		writeFileSync(recordFile, '{"contract":"corrupted"}\n');

		await expect(
			commitBatchChild({
				root: repo.root,
				taskId,
				batchId: "batch-1",
				expectedHead: repo.baseHead,
			}),
		).rejects.toThrow();

		expect(git(repo.root, ["rev-parse", "HEAD"])).toBe(repo.baseHead);
	});

	it("refuses to commit before Kernel reports child done", async () => {
		const taskId = "task-not-done";
		mkdirSync(join(repo.root, "src"), { recursive: true });
		writeFileSync(join(repo.root, "src", "foo.ts"), "code\n");

		// Case 1: no audit pair
		await expect(
			commitBatchChild({
				root: repo.root,
				taskId,
				batchId: "batch-1",
				expectedHead: repo.baseHead,
			}),
		).rejects.toThrow(/not settled done/);

		// Case 2: audit pair has lifecycle "stopped", not "done"
		writeChildAudit(repo.root, taskId, "stopped", repo.baseHead);
		await expect(
			commitBatchChild({
				root: repo.root,
				taskId,
				batchId: "batch-1",
				expectedHead: repo.baseHead,
			}),
		).rejects.toThrow(/not settled done/);

		expect(git(repo.root, ["rev-parse", "HEAD"])).toBe(repo.baseHead);
	});

	it("commits changes within scope envelope + .imm/audit/<task-id>/** with formatted message and trailer", async () => {
		const taskId = "task-settled-1";
		const intent = {
			contract: "assurance_kernel/task_intent/v1",
			task_id: taskId,
			owner: "user",
			goal: "Implement feature X\nSecond line of description",
			scope_hint: ["src/feature.ts", "docs/plans/archive/task-settled-1.intent.json"],
			acceptance: [
				{
					id: `acc-${taskId}`,
					assertion: "assert something",
					verification: "bun test",
				},
			],
			risk: "material",
			revision: 1,
		};
		writeChildAudit(repo.root, taskId, "done", repo.baseHead, intent);

		mkdirSync(join(repo.root, "src"), { recursive: true });
		writeFileSync(join(repo.root, "src", "feature.ts"), "export const x = 1;\n");

		const res = await commitBatchChild({
			root: repo.root,
			taskId,
			batchId: "batch-123",
			expectedHead: repo.baseHead,
		});

		expect(res.commit).toBeDefined();
		expect(git(repo.root, ["rev-parse", "HEAD"])).toBe(res.commit);

		// Lineage check: single parent equals baseHead
		const parents = git(repo.root, ["rev-parse", "HEAD^@"]).split(/\s+/).filter(Boolean);
		expect(parents).toEqual([repo.baseHead]);

		// Message and trailer check
		const commitMessage = git(repo.root, ["log", "-n", "1", "--format=%B"]);
		expect(commitMessage).toContain("imm(task-settled-1): Implement feature X");
		expect(commitMessage).toContain("Immune-Brain-Batch: batch-123");

		const trailer = git(repo.root, [
			"log",
			"-n",
			"1",
			"--format=%(trailers:key=Immune-Brain-Batch,valueonly)",
		]);
		expect(trailer).toBe("batch-123");

		const committedFiles = git(repo.root, ["diff-tree", "--no-commit-id", "--name-only", "-r", res.commit]).split("\n");
		expect(committedFiles).toContain("src/feature.ts");
		expect(committedFiles).toContain(".imm/audit/task-settled-1/task-record.json");
		expect(committedFiles).toContain(".imm/audit/task-settled-1/terminal-proof.json");
	});

	it("Finding 1: rejects out-of-scope files even if the on-disk intent file was modified to widen scope_hint", async () => {
		const taskId = "task-tamper-intent";
		const authorizedIntent = {
			contract: "assurance_kernel/task_intent/v1",
			task_id: taskId,
			owner: "user",
			goal: "Authorized Goal",
			scope_hint: ["src/authorized.ts"],
			acceptance: [{ id: `acc-${taskId}`, assertion: "assert", verification: "bun test" }],
			risk: "material",
			revision: 1,
		};
		writeChildAudit(repo.root, taskId, "done", repo.baseHead, authorizedIntent);

		mkdirSync(join(repo.root, "src"), { recursive: true });
		writeFileSync(join(repo.root, "src", "authorized.ts"), "authorized\n");
		writeFileSync(join(repo.root, "src", "rogue.ts"), "rogue\n");

		// Attacker modifies mutable on-disk intent file to include rogue.ts:
		writeTaskIntent(repo.root, taskId, "Attacker Goal", ["src/authorized.ts", "src/rogue.ts"]);

		// Must reject because TaskRecord.intent_snapshot does not allow rogue.ts:
		await expect(
			commitBatchChild({
				root: repo.root,
				taskId,
				batchId: "batch-1",
				expectedHead: repo.baseHead,
			}),
		).rejects.toThrow("dirty_outside_scope");

		expect(git(repo.root, ["rev-parse", "HEAD"])).toBe(repo.baseHead);
	});

	it("Finding 4: rejects files with trailing whitespace as dirty_outside_scope", async () => {
		const taskId = "task-trailing-space";
		const authorizedIntent = {
			contract: "assurance_kernel/task_intent/v1",
			task_id: taskId,
			owner: "user",
			goal: "Trailing Space Goal",
			scope_hint: ["src/allowed.ts"],
			acceptance: [{ id: `acc-${taskId}`, assertion: "assert", verification: "bun test" }],
			risk: "material",
			revision: 1,
		};
		writeChildAudit(repo.root, taskId, "done", repo.baseHead, authorizedIntent);

		mkdirSync(join(repo.root, "src"), { recursive: true });
		writeFileSync(join(repo.root, "src", "allowed.ts"), "allowed\n");
		// File with trailing space:
		writeFileSync(join(repo.root, "src", "allowed.ts "), "space-infiltrator\n");

		await expect(
			commitBatchChild({
				root: repo.root,
				taskId,
				batchId: "batch-1",
				expectedHead: repo.baseHead,
			}),
		).rejects.toThrow("dirty_outside_scope");

		expect(git(repo.root, ["rev-parse", "HEAD"])).toBe(repo.baseHead);
	});

	it("terminates with dirty_outside_scope when modifying another task's audit directory", async () => {
		const taskId = "task-audit-tamper";
		writeChildAudit(repo.root, taskId, "done", repo.baseHead);
		writeChildAudit(repo.root, "foreign-task", "done", repo.baseHead);

		await expect(
			commitBatchChild({
				root: repo.root,
				taskId,
				batchId: "batch-1",
				expectedHead: repo.baseHead,
			}),
		).rejects.toThrow("dirty_outside_scope");

		expect(git(repo.root, ["rev-parse", "HEAD"])).toBe(repo.baseHead);
	});

	it("terminates as failed with lineage error if current HEAD does not match expected_head", async () => {
		const taskId = "task-lineage";
		writeChildAudit(repo.root, taskId, "done", repo.baseHead);

		await expect(
			commitBatchChild({
				root: repo.root,
				taskId,
				batchId: "batch-1",
				expectedHead: "f".repeat(40),
			}),
		).rejects.toThrow(/batch_head_lineage_broken/);
	});

	it("Finding 2: rejects hidden out-of-scope modification carrying assume-unchanged as dirty_outside_scope", async () => {
		const taskId = "task-assume-unchanged";
		const intent = {
			contract: "assurance_kernel/task_intent/v1",
			task_id: taskId,
			owner: "user",
			goal: "Assume unchanged goal",
			scope_hint: ["src/allowed.ts"],
			acceptance: [{ id: `acc-${taskId}`, assertion: "assert", verification: "bun test" }],
			risk: "material",
			revision: 1,
		};
		writeChildAudit(repo.root, taskId, "done", repo.baseHead, intent);
		mkdirSync(join(repo.root, "src"), { recursive: true });
		writeFileSync(join(repo.root, "src", "allowed.ts"), "allowed\n");

		// Out-of-scope tracked file hidden with --assume-unchanged
		writeFileSync(join(repo.root, "out-of-scope.txt"), "initial\n");
		git(repo.root, ["add", "out-of-scope.txt"]);
		git(repo.root, ["commit", "-m", "add out of scope"]);
		const baseNow = git(repo.root, ["rev-parse", "HEAD"]);

		// Modify out-of-scope file and hide it
		writeFileSync(join(repo.root, "out-of-scope.txt"), "modified-secret\n");
		git(repo.root, ["update-index", "--assume-unchanged", "out-of-scope.txt"]);

		await expect(
			commitBatchChild({
				root: repo.root,
				taskId,
				batchId: "batch-assume-1",
				expectedHead: baseNow,
			}),
		).rejects.toThrow("dirty_outside_scope");
	});

	it("Finding 1: rejects hidden out-of-scope modification carrying combined flags (tag s) as dirty_outside_scope", async () => {
		const taskId = "task-combined-flags";
		const intent = {
			contract: "assurance_kernel/task_intent/v1",
			task_id: taskId,
			owner: "user",
			goal: "Combined flags goal",
			scope_hint: ["src/allowed.ts"],
			acceptance: [{ id: `acc-${taskId}`, assertion: "assert", verification: "bun test" }],
			risk: "material",
			revision: 1,
		};
		writeChildAudit(repo.root, taskId, "done", repo.baseHead, intent);
		mkdirSync(join(repo.root, "src"), { recursive: true });
		writeFileSync(join(repo.root, "src", "allowed.ts"), "allowed\n");

		writeFileSync(join(repo.root, "out-of-scope-s.txt"), "initial\n");
		git(repo.root, ["add", "out-of-scope-s.txt"]);
		git(repo.root, ["commit", "-m", "add out of scope s"]);
		const baseNow = git(repo.root, ["rev-parse", "HEAD"]);

		writeFileSync(join(repo.root, "out-of-scope-s.txt"), "modified-s\n");
		git(repo.root, ["update-index", "--skip-worktree", "out-of-scope-s.txt"]);
		git(repo.root, ["update-index", "--assume-unchanged", "out-of-scope-s.txt"]);

		await expect(
			commitBatchChild({
				root: repo.root,
				taskId,
				batchId: "batch-s-1",
				expectedHead: baseNow,
			}),
		).rejects.toThrow("dirty_outside_scope");
	});

	it("Finding 2: commits scoped staged deletion and staged rename without pathspec errors", async () => {
		const taskId = "task-rm-mv";
		mkdirSync(join(repo.root, "src"), { recursive: true });
		writeFileSync(join(repo.root, "src", "to-delete.ts"), "delete me\n");
		writeFileSync(join(repo.root, "src", "to-rename.ts"), "rename me\n");
		git(repo.root, ["add", "src"]);
		git(repo.root, ["commit", "-m", "add initial files"]);
		const baseNow = git(repo.root, ["rev-parse", "HEAD"]);

		const intent = {
			contract: "assurance_kernel/task_intent/v1",
			task_id: taskId,
			owner: "user",
			goal: "Delete and rename files",
			scope_hint: ["src/to-delete.ts", "src/to-rename.ts", "src/renamed.ts"],
			acceptance: [{ id: `acc-${taskId}`, assertion: "assert", verification: "bun test" }],
			risk: "material",
			revision: 1,
		};
		writeChildAudit(repo.root, taskId, "done", baseNow, intent);

		git(repo.root, ["rm", "src/to-delete.ts"]);
		git(repo.root, ["mv", "src/to-rename.ts", "src/renamed.ts"]);

		const res = await commitBatchChild({
			root: repo.root,
			taskId,
			batchId: "batch-rm-mv-1",
			expectedHead: baseNow,
		});

		expect(res.commit).toBeDefined();
		expect(git(repo.root, ["rev-parse", "HEAD"])).toBe(res.commit);

		const committedFiles = git(repo.root, ["diff-tree", "--no-commit-id", "--name-only", "-r", res.commit]).split("\n");
		expect(committedFiles).toContain("src/to-delete.ts");
		expect(committedFiles).toContain("src/renamed.ts");
	});

	it("review round 7: commitBatchChild rejects a same-SHA branch switch before settlement", async () => {
		const taskId = "task-branch-switch";
		const intent = {
			contract: "assurance_kernel/task_intent/v1",
			task_id: taskId,
			owner: "user",
			goal: "Branch switch goal",
			scope_hint: ["src/allowed.ts"],
			acceptance: [{ id: `acc-${taskId}`, assertion: "assert", verification: "bun test" }],
			risk: "material",
			revision: 1,
		};
		// Switch to a decoy branch at the same SHA as imm/test-initiative
		git(repo.root, ["checkout", "-b", "decoy-branch"]);

		writeChildAudit(repo.root, taskId, "done", repo.baseHead, intent);
		mkdirSync(join(repo.root, "src"), { recursive: true });
		writeFileSync(join(repo.root, "src", "allowed.ts"), "allowed\n");

		await expect(
			commitBatchChild({
				root: repo.root,
				taskId,
				batchId: "batch-branch-switch",
				expectedHead: repo.baseHead,
				branch: "imm/test-initiative",
			}),
		).rejects.toThrow(/batch_head_lineage_broken/);

		// Nothing was committed on the decoy branch
		expect(git(repo.root, ["rev-parse", "HEAD"])).toBe(repo.baseHead);
	});

	it("Finding 1: pre-commit hook staging unauthorized files is bypassed by --no-verify", async () => {
		const taskId = "task-hook-bypass";
		const intent = {
			contract: "assurance_kernel/task_intent/v1",
			task_id: taskId,
			owner: "user",
			goal: "Hook bypass goal",
			scope_hint: ["src/hook-allowed.ts"],
			acceptance: [{ id: `acc-${taskId}`, assertion: "assert", verification: "bun test" }],
			risk: "material",
			revision: 1,
		};
		writeChildAudit(repo.root, taskId, "done", repo.baseHead, intent);
		mkdirSync(join(repo.root, "src"), { recursive: true });
		writeFileSync(join(repo.root, "src", "hook-allowed.ts"), "allowed\n");

		// Install malicious/rogue pre-commit hook
		const hooksDir = join(repo.root, ".git", "hooks");
		mkdirSync(hooksDir, { recursive: true });
		const hookFile = join(hooksDir, "pre-commit");
		writeFileSync(hookFile, "#!/bin/sh\necho leak > rogue-from-hook.txt\ngit add rogue-from-hook.txt\n");
		spawnSync("chmod", ["+x", hookFile]);

		const res = await commitBatchChild({
			root: repo.root,
			taskId,
			batchId: "batch-hook-1",
			expectedHead: repo.baseHead,
		});

		expect(res.commit).toBeDefined();
		const committedFiles = git(repo.root, ["diff-tree", "--no-commit-id", "--name-only", "-r", res.commit]).split("\n");
		expect(committedFiles).not.toContain("rogue-from-hook.txt");
		expect(committedFiles).toContain("src/hook-allowed.ts");
	});

	it("Finding 1: prepare-commit-msg and post-commit hooks are bypassed via core.hooksPath=/dev/null", async () => {
		const taskId = "task-hooks-all";
		const intent = {
			contract: "assurance_kernel/task_intent/v1",
			task_id: taskId,
			owner: "user",
			goal: "Hooks all goal",
			scope_hint: ["src/hook-all.ts"],
			acceptance: [{ id: `acc-${taskId}`, assertion: "assert", verification: "bun test" }],
			risk: "material",
			revision: 1,
		};
		writeChildAudit(repo.root, taskId, "done", repo.baseHead, intent);
		mkdirSync(join(repo.root, "src"), { recursive: true });
		writeFileSync(join(repo.root, "src", "hook-all.ts"), "allowed\n");

		const hooksDir = join(repo.root, ".git", "hooks");
		mkdirSync(hooksDir, { recursive: true });
		// Hook trying to rewrite message / trailer:
		writeFileSync(join(hooksDir, "prepare-commit-msg"), "#!/bin/sh\necho 'tampered' > \"$1\"\n");
		// Hook trying to amend and add untracked file:
		writeFileSync(join(hooksDir, "post-commit"), "#!/bin/sh\necho bad > bad.txt && git add bad.txt && git commit --amend -C HEAD\n");
		spawnSync("chmod", ["+x", join(hooksDir, "prepare-commit-msg"), join(hooksDir, "post-commit")]);

		const res = await commitBatchChild({
			root: repo.root,
			taskId,
			batchId: "batch-hooks-all",
			expectedHead: repo.baseHead,
		});

		expect(res.commit).toBeDefined();
		const msg = git(repo.root, ["log", "-n", "1", "--format=%B", res.commit]);
		expect(msg).toContain("imm(task-hooks-all): Hooks all goal");
		expect(msg).toContain("Immune-Brain-Batch: batch-hooks-all");

		const committedFiles = git(repo.root, ["diff-tree", "--no-commit-id", "--name-only", "-r", res.commit]).split("\n");
		expect(committedFiles).not.toContain("bad.txt");
	});

	it("Finding 2: rejects POSIX backslash filename src\\allowed.ts as dirty_outside_scope", async () => {
		const taskId = "task-backslash";
		const intent = {
			contract: "assurance_kernel/task_intent/v1",
			task_id: taskId,
			owner: "user",
			goal: "Backslash test",
			scope_hint: ["src/allowed.ts"],
			acceptance: [{ id: `acc-${taskId}`, assertion: "assert", verification: "bun test" }],
			risk: "material",
			revision: 1,
		};
		writeChildAudit(repo.root, taskId, "done", repo.baseHead, intent);

		mkdirSync(join(repo.root, "src"), { recursive: true });
		writeFileSync(join(repo.root, "src", "allowed.ts"), "allowed\n");
		// Literal backslash in root-level filename on POSIX:
		writeFileSync(join(repo.root, "src\\allowed.ts"), "backslash-attacker\n");

		await expect(
			commitBatchChild({
				root: repo.root,
				taskId,
				batchId: "batch-1",
				expectedHead: repo.baseHead,
			}),
		).rejects.toThrow("dirty_outside_scope");

		expect(git(repo.root, ["rev-parse", "HEAD"])).toBe(repo.baseHead);
	});

	it("Finding 3: lookupBatchCommit verifies HEAD and single parent, and detects external HEAD drift", async () => {
		const taskId = "task-lookup";
		const intent = {
			contract: "assurance_kernel/task_intent/v1",
			task_id: taskId,
			owner: "user",
			goal: "Lookup test",
			scope_hint: ["src/lookup.ts"],
			acceptance: [{ id: `acc-${taskId}`, assertion: "assert", verification: "bun test" }],
			risk: "material",
			revision: 1,
		};
		writeChildAudit(repo.root, taskId, "done", repo.baseHead, intent);
		mkdirSync(join(repo.root, "src"), { recursive: true });
		writeFileSync(join(repo.root, "src", "lookup.ts"), "code\n");

		const { commit } = await commitBatchChild({
			root: repo.root,
			taskId,
			batchId: "batch-xyz",
			expectedHead: repo.baseHead,
		});

		// 1. Success case: current HEAD === commit and parent === expectedHead
		const found = await lookupBatchCommit({
			root: repo.root,
			taskId,
			batchId: "batch-xyz",
			expectedHead: repo.baseHead,
		});
		expect(found).not.toBeNull();
		expect(found!.commit).toBe(commit);

		// 2. Finding 3: External commit moves HEAD past the batch commit -> throws lineage error
		writeFileSync(join(repo.root, "external.txt"), "external\n");
		git(repo.root, ["add", "external.txt"]);
		git(repo.root, ["commit", "-m", "external commit"]);

		await expect(
			lookupBatchCommit({
				root: repo.root,
				taskId,
				batchId: "batch-xyz",
				expectedHead: repo.baseHead,
			}),
		).rejects.toThrow(/batch_head_lineage_broken/);
	});

	it("Finding 1: lookupBatchCommit rejects in-scope external commit lacking durable batch commit evidence", async () => {
		const taskId = "task-forged-lookup";
		const intent = {
			contract: "assurance_kernel/task_intent/v1",
			task_id: taskId,
			owner: "user",
			goal: "Forged lookup goal",
			scope_hint: ["src/forged.ts"],
			acceptance: [{ id: `acc-${taskId}`, assertion: "assert", verification: "bun test" }],
			risk: "material",
			revision: 1,
		};
		writeChildAudit(repo.root, taskId, "done", repo.baseHead, intent);
		mkdirSync(join(repo.root, "src"), { recursive: true });
		writeFileSync(join(repo.root, "src", "forged.ts"), "code\n");
		git(repo.root, ["add", "src/forged.ts"]);

		// External commit matching batch author and trailer, but NOT produced by commitBatchChild
		const msg = `imm(${taskId}): Forged lookup goal\n\nImmune-Brain-Batch: batch-fake-1\n`;
		git(repo.root, [
			"-c",
			"user.name=Immune-Brain Batch",
			"-c",
			"user.email=immune-brain@local",
			"commit",
			"-m",
			msg,
		]);

		await expect(
			lookupBatchCommit({
				root: repo.root,
				taskId,
				batchId: "batch-fake-1",
				expectedHead: repo.baseHead,
			}),
		).rejects.toThrow(/lacks durable batch runner production evidence/);
	});
});

describe("batch runner integration: branch and scope-bounded commit", () => {
	let repo: { root: string; baseHead: string };

	beforeEach(() => {
		repo = initGitRepo();
	});

	afterEach(() => {
		rmSync(repo.root, { recursive: true, force: true });
	});

	function makeBatchInput(
		children: BatchPlanChild[],
		kernel: BatchRunnerKernelPort,
		slug = "test-init",
		batchId = "batch-int-1",
	) {
		const registry = createBatchAuthorityRegistry();
		const planDigest = computeBatchPlanDigest(
			children.map((c) => ({
				task_id: c.task_id,
				intent_path: c.intent_path!,
				intent_revision: c.intent_revision!,
				intent_content_hash: c.intent_content_hash!,
				blocked_by: c.blocked_by,
			})),
		);
		const capability = registry.issue(
			{
				batch_id: batchId,
				initiative_slug: slug,
				plan_digest: planDigest,
				branch: `imm/${slug}`,
				base_head: repo.baseHead,
				budget: { max_children: 5, deadline_at: FAR_FUTURE, qa_failure_limit: 3 },
				actor_id: "user",
				confirmation_ref: "confirm-1",
				expires_at: FAR_FUTURE,
				nonce: "nonce-1",
			},
			children,
			CONFIRMATION_TIME,
		);

		return {
			root: repo.root,
			batch_id: batchId,
			initiative_slug: slug,
			registry,
			capability,
			children,
			plan_digest: planDigest,
			base_head: repo.baseHead,
			confirmation_time: CONFIRMATION_TIME,
			authorization_expires_at: FAR_FUTURE,
			budget: { max_children: 5, deadline_at: FAR_FUTURE, qa_failure_limit: 3 },
			now: "2026-01-01T01:00:00.000Z",
			kernel,
		};
	}

	it("executes full batch: passing preflight creates branch, settled children advance lineage", async () => {
		const slug = "feature-flow";
		const taskA = "task-a";
		const taskB = "task-b";

		const intentPathA = writeTaskIntent(repo.root, taskA, "Task A goal", [
			"src/a.ts",
			`docs/plans/archive/${taskA}.intent.json`,
		]);
		const intentPathB = writeTaskIntent(repo.root, taskB, "Task B goal", [
			"src/b.ts",
			`docs/plans/archive/${taskB}.intent.json`,
		]);

		git(repo.root, ["add", "docs/plans"]);
		git(repo.root, ["commit", "-m", "add intent files"]);
		repo.baseHead = git(repo.root, ["rev-parse", "HEAD"]);

		const children: BatchPlanChild[] = [
			{
				task_id: taskA,
				slice_id: "S1",
				blocked_by: [],
				status: "enrollable",
				reason: null,
				intent_path: intentPathA,
				intent_revision: 1,
				intent_content_hash: "a".repeat(64),
			},
			{
				task_id: taskB,
				slice_id: "S2",
				blocked_by: [taskA],
				status: "enrollable",
				reason: null,
				intent_path: intentPathB,
				intent_revision: 1,
				intent_content_hash: "b".repeat(64),
			},
		];

		const kernel: BatchRunnerKernelPort = {
			async enrollTask() {
				return { record_revision: "rev-1" };
			},
			async advanceTask(root, taskId) {
				if (taskId === taskA) {
					mkdirSync(join(root, "src"), { recursive: true });
					writeFileSync(join(root, "src", "a.ts"), "content a\n");
					writeChildAudit(root, taskA, "done", repo.baseHead, {
						contract: "assurance_kernel/task_intent/v1",
						task_id: taskA,
						owner: "user",
						goal: "Task A goal",
						scope_hint: ["src/a.ts", `docs/plans/archive/${taskA}.intent.json`],
						acceptance: [{ id: `acc-${taskA}`, assertion: "assert", verification: "bun test" }],
						risk: "material",
						revision: 1,
					});
				} else if (taskId === taskB) {
					mkdirSync(join(root, "src"), { recursive: true });
					writeFileSync(join(root, "src", "b.ts"), "content b\n");
					const headNow = git(root, ["rev-parse", "HEAD"]);
					writeChildAudit(root, taskB, "done", headNow, {
						contract: "assurance_kernel/task_intent/v1",
						task_id: taskB,
						owner: "user",
						goal: "Task B goal",
						scope_hint: ["src/b.ts", `docs/plans/archive/${taskB}.intent.json`],
						acceptance: [{ id: `acc-${taskB}`, assertion: "assert", verification: "bun test" }],
						risk: "material",
						revision: 1,
					});
				}
				return { state: "completed" };
			},
			async projectTask(_root, taskId) {
				return {
					contract: "assurance_kernel/assurance_projection/v1",
					task_id: taskId,
					error: null,
					claim: null,
					projection: { lifecycle: "active", completion_ready: false } as never,
				};
			},
			ownsTaskClaim() {
				return true;
			},
			validateBatchAuthorization(input) {
				return input.registry.inspect(input.capability, input.binding);
			},
		};

		const input = makeBatchInput(children, kernel, slug, "batch-flow-1");
		const report = await startBatch(input);

		expect(report.batch_state).toBe("completed");
		expect(report.commits).toHaveLength(2);

		expect(git(repo.root, ["symbolic-ref", "--short", "HEAD"])).toBe(`imm/${slug}`);

		const stateRecord = readBatchRunState(repo.root, "batch-flow-1");
		expect(stateRecord).not.toBeNull();
		expect(stateRecord!.branch).toBe(`imm/${slug}`);
		expect(stateRecord!.commits).toHaveLength(2);

		const commitB = report.commits[1]!;
		const commitA = report.commits[0]!;
		expect(git(repo.root, ["rev-parse", `${commitB}~1`])).toBe(commitA);
		expect(git(repo.root, ["rev-parse", `${commitA}~1`])).toBe(repo.baseHead);

		expect(git(repo.root, ["log", "-n", "1", "--format=%B", commitA])).toContain("imm(task-a): Task A goal");
		expect(git(repo.root, ["log", "-n", "1", "--format=%B", commitB])).toContain("imm(task-b): Task B goal");
	});

	it("stops batch as failed with dirty_outside_scope when a child produces out-of-scope changes", async () => {
		const slug = "leak-flow";
		const taskA = "task-leak-a";

		const intentPathA = writeTaskIntent(repo.root, taskA, "Task A goal", [
			"src/a.ts",
			`docs/plans/archive/${taskA}.intent.json`,
		]);

		git(repo.root, ["add", "docs/plans"]);
		git(repo.root, ["commit", "-m", "add intent file"]);
		repo.baseHead = git(repo.root, ["rev-parse", "HEAD"]);

		const children: BatchPlanChild[] = [
			{
				task_id: taskA,
				slice_id: "S1",
				blocked_by: [],
				status: "enrollable",
				reason: null,
				intent_path: intentPathA,
				intent_revision: 1,
				intent_content_hash: "a".repeat(64),
			},
		];

		const kernel: BatchRunnerKernelPort = {
			async enrollTask() {
				return { record_revision: "rev-1" };
			},
			async advanceTask(root, taskId) {
				mkdirSync(join(root, "src"), { recursive: true });
				writeFileSync(join(root, "src", "a.ts"), "content a\n");
				writeFileSync(join(root, "unscoped.txt"), "leak\n");
				writeChildAudit(root, taskId, "done", repo.baseHead, {
					contract: "assurance_kernel/task_intent/v1",
					task_id: taskId,
					owner: "user",
					goal: "Task A goal",
					scope_hint: ["src/a.ts", `docs/plans/archive/${taskId}.intent.json`],
					acceptance: [{ id: `acc-${taskId}`, assertion: "assert", verification: "bun test" }],
					risk: "material",
					revision: 1,
				});
				return { state: "completed" };
			},
			async projectTask(_root, taskId) {
				return {
					contract: "assurance_kernel/assurance_projection/v1",
					task_id: taskId,
					error: null,
					claim: null,
					projection: { lifecycle: "active", completion_ready: false } as never,
				};
			},
			ownsTaskClaim() {
				return true;
			},
			validateBatchAuthorization(input) {
				return input.registry.inspect(input.capability, input.binding);
			},
		};

		const input = makeBatchInput(children, kernel, slug, "batch-leak-1");
		const report = await startBatch(input);

		expect(report.batch_state).toBe("failed");
		expect(report.reason).toContain("dirty_outside_scope");
		expect(report.commits).toHaveLength(0);

		expect(git(repo.root, ["rev-parse", "HEAD"])).toBe(repo.baseHead);
	});

	it("terminates as rejected when branch already exists before startBatch, leaving zero batch state files", async () => {
		const slug = "exist-flow";
		const taskA = "task-exist-a";
		const intentPathA = writeTaskIntent(repo.root, taskA, "Goal", [`docs/plans/${taskA}.intent.json`]);

		git(repo.root, ["add", "docs/plans"]);
		git(repo.root, ["commit", "-m", "add intent file"]);
		repo.baseHead = git(repo.root, ["rev-parse", "HEAD"]);

		git(repo.root, ["branch", `imm/${slug}`, repo.baseHead]);
		const originalBranch = git(repo.root, ["symbolic-ref", "--short", "HEAD"]);

		const children: BatchPlanChild[] = [
			{
				task_id: taskA,
				slice_id: "S1",
				blocked_by: [],
				status: "enrollable",
				reason: null,
				intent_path: intentPathA,
				intent_revision: 1,
				intent_content_hash: "a".repeat(64),
			},
		];

		const kernel: BatchRunnerKernelPort = {
			async enrollTask() {
				throw new Error("must not be called");
			},
			async advanceTask() {
				throw new Error("must not be called");
			},
			async projectTask(_root, taskId) {
				return {
					contract: "assurance_kernel/assurance_projection/v1",
					task_id: taskId,
					error: null,
					claim: null,
					projection: { lifecycle: "active", completion_ready: false } as never,
				};
			},
			ownsTaskClaim() {
				return false;
			},
			validateBatchAuthorization(input) {
				return input.registry.inspect(input.capability, input.binding);
			},
		};

		const input = makeBatchInput(children, kernel, slug, "batch-exist-1");
		const report = await startBatch(input);

		expect(report.batch_state).toBe("rejected");
		expect(report.reason).toBe("batch_branch_exists");

		expect(existsSync(join(repo.root, ".imm", "state", "batches", "batch-exist-1.json"))).toBe(false);
		expect(existsSync(join(repo.root, ".imm", "state", "batches", "batch-exist-1.report.json"))).toBe(false);

		expect(git(repo.root, ["symbolic-ref", "--short", "HEAD"])).toBe(originalBranch);
	});

	it("Finding 3: resumeBatch terminates as failed when external HEAD drift occurs before commit lookup", async () => {
		const slug = "drift-flow";
		const taskA = "task-drift-a";
		const intentPathA = writeTaskIntent(repo.root, taskA, "Goal", [
			"src/a.ts",
			`docs/plans/archive/${taskA}.intent.json`,
		]);

		git(repo.root, ["add", "docs/plans"]);
		git(repo.root, ["commit", "-m", "add intent file"]);
		repo.baseHead = git(repo.root, ["rev-parse", "HEAD"]);

		const children: BatchPlanChild[] = [
			{
				task_id: taskA,
				slice_id: "S1",
				blocked_by: [],
				status: "enrollable",
				reason: null,
				intent_path: intentPathA,
				intent_revision: 1,
				intent_content_hash: "a".repeat(64),
			},
		];

		// First: run preflight to create branch
		runBatchGitPreflight({ root: repo.root, initiative_slug: slug, base_head: repo.baseHead });

		// Settle taskA in audit and create its commit
		mkdirSync(join(repo.root, "src"), { recursive: true });
		writeFileSync(join(repo.root, "src", "a.ts"), "content a\n");
		writeChildAudit(repo.root, taskA, "done", repo.baseHead, {
			contract: "assurance_kernel/task_intent/v1",
			task_id: taskA,
			owner: "user",
			goal: "Goal",
			scope_hint: ["src/a.ts", `docs/plans/archive/${taskA}.intent.json`],
			acceptance: [{ id: `acc-${taskA}`, assertion: "assert", verification: "bun test" }],
			risk: "material",
			revision: 1,
		});

		const { commit } = await commitBatchChild({
			root: repo.root,
			taskId: taskA,
			batchId: "batch-drift-1",
			expectedHead: repo.baseHead,
		});

		// External commit moves HEAD past the batch commit before resume
		writeFileSync(join(repo.root, "external.txt"), "external\n");
		git(repo.root, ["add", "external.txt"]);
		git(repo.root, ["commit", "-m", "external commit moving HEAD"]);

		const kernel: BatchRunnerKernelPort = {
			async enrollTask() {
				throw new Error("not called");
			},
			async advanceTask() {
				return { state: "completed" };
			},
			async projectTask(_root, taskId) {
				return {
					contract: "assurance_kernel/assurance_projection/v1",
					task_id: taskId,
					error: null,
					claim: { task_id: taskId, lifecycle_status: "active" },
					projection: { lifecycle: "done", completion_ready: true } as never,
				};
			},
			ownsTaskClaim() {
				return true;
			},
			validateBatchAuthorization(input) {
				return input.registry.inspect(input.capability, input.binding);
			},
		};

		const batchInput = makeBatchInput(children, kernel, slug, "batch-drift-1");

		// Persist state as if crash happened after settlement before committed-persist
		const stateRecord = {
			contract: "assurance_kernel/batch_run_state/v1" as const,
			batch_id: "batch-drift-1",
			initiative_slug: slug,
			plan_digest: batchInput.plan_digest,
			base_head: repo.baseHead,
			branch: `imm/${slug}`,
			confirmation_time: CONFIRMATION_TIME,
			authorization_expires_at: FAR_FUTURE,
			budget: { max_children: 5, deadline_at: FAR_FUTURE, qa_failure_limit: 3 },
			batch_state: "running" as const,
			children: [
				{
					task_id: taskA,
					slice_id: "S1",
					blocked_by: [],
					state: "settled" as const,
					reason: null,
					commit: null,
				},
			],
			consecutive_qa_failures: 0,
			commits: [],
			created_at: CONFIRMATION_TIME,
			updated_at: CONFIRMATION_TIME,
		};
		const { writeBatchRunState } = await import("../plugins/immune-brain/runtime/unattended/batch_state");
		writeBatchRunState(repo.root, stateRecord);

		const report = await resumeBatch(batchInput, kernel.projectTask.bind(kernel));

		expect(report.batch_state).toBe("failed");
		expect(report.reason).toContain("batch_head_lineage_broken");

		const stored = readBatchRunState(repo.root, "batch-drift-1");
		expect(stored!.batch_state).toBe("failed");
	});

	it("Finding 3: resumeBatch rejects a forged commit containing out-of-scope changes as failed", async () => {
		const slug = "forged-flow";
		const taskA = "task-forged-a";
		const intentPathA = writeTaskIntent(repo.root, taskA, "Goal", [
			"src/a.ts",
			`docs/plans/archive/${taskA}.intent.json`,
		]);

		git(repo.root, ["add", "docs/plans"]);
		git(repo.root, ["commit", "-m", "add intent file"]);
		repo.baseHead = git(repo.root, ["rev-parse", "HEAD"]);

		const children: BatchPlanChild[] = [
			{
				task_id: taskA,
				slice_id: "S1",
				blocked_by: [],
				status: "enrollable",
				reason: null,
				intent_path: intentPathA,
				intent_revision: 1,
				intent_content_hash: "a".repeat(64),
			},
		];

		runBatchGitPreflight({ root: repo.root, initiative_slug: slug, base_head: repo.baseHead });

		// Settle taskA in audit with authorized scope strictly src/a.ts
		writeChildAudit(repo.root, taskA, "done", repo.baseHead, {
			contract: "assurance_kernel/task_intent/v1",
			task_id: taskA,
			owner: "user",
			goal: "Goal",
			scope_hint: ["src/a.ts", `docs/plans/archive/${taskA}.intent.json`],
			acceptance: [{ id: `acc-${taskA}`, assertion: "assert", verification: "bun test" }],
			risk: "material",
			revision: 1,
		});

		// External attacker commits a forged commit with the expected message/trailer but changing forged-leak.txt
		writeFileSync(join(repo.root, "forged-leak.txt"), "leak\n");
		git(repo.root, ["add", "forged-leak.txt"]);
		const forgedMsg = `imm(${taskA}): Goal\n\nImmune-Brain-Batch: batch-forged-1\n`;
		git(repo.root, ["commit", "-m", forgedMsg]);

		const kernel: BatchRunnerKernelPort = {
			async enrollTask() {
				throw new Error("not called");
			},
			async advanceTask() {
				return { state: "completed" };
			},
			async projectTask(_root, taskId) {
				return {
					contract: "assurance_kernel/assurance_projection/v1",
					task_id: taskId,
					error: null,
					claim: { task_id: taskId, lifecycle_status: "active" },
					projection: { lifecycle: "done", completion_ready: true } as never,
				};
			},
			ownsTaskClaim() {
				return true;
			},
			validateBatchAuthorization(input) {
				return input.registry.inspect(input.capability, input.binding);
			},
		};

		const batchInput = makeBatchInput(children, kernel, slug, "batch-forged-1");

		const stateRecord = {
			contract: "assurance_kernel/batch_run_state/v1" as const,
			batch_id: "batch-forged-1",
			initiative_slug: slug,
			plan_digest: batchInput.plan_digest,
			base_head: repo.baseHead,
			branch: `imm/${slug}`,
			confirmation_time: CONFIRMATION_TIME,
			authorization_expires_at: FAR_FUTURE,
			budget: { max_children: 5, deadline_at: FAR_FUTURE, qa_failure_limit: 3 },
			batch_state: "running" as const,
			children: [
				{
					task_id: taskA,
					slice_id: "S1",
					blocked_by: [],
					state: "settled" as const,
					reason: null,
					commit: null,
				},
			],
			consecutive_qa_failures: 0,
			commits: [],
			created_at: CONFIRMATION_TIME,
			updated_at: CONFIRMATION_TIME,
		};
		const { writeBatchRunState } = await import("../plugins/immune-brain/runtime/unattended/batch_state");
		writeBatchRunState(repo.root, stateRecord);

		const report = await resumeBatch(batchInput, kernel.projectTask.bind(kernel));

		expect(report.batch_state).toBe("failed");
		expect(report.reason).toContain("batch_head_lineage_broken");

		const stored = readBatchRunState(repo.root, "batch-forged-1");
		expect(stored!.batch_state).toBe("failed");
	});

	it("Finding 1: symlink attack on commit evidence is rejected and target remains untouched", async () => {
		const outsideDir = mkdtempSync(join(tmpdir(), "outside-evidence-"));
		try {
			const sensitiveFile = join(outsideDir, "sensitive.txt");
			writeFileSync(sensitiveFile, "precious content\n");

			const taskId = "task-symlink-attack";
			const intent = {
				contract: "assurance_kernel/task_intent/v1",
				task_id: taskId,
				owner: "user",
				goal: "Symlink attack test",
				scope_hint: ["src/symlink.ts"],
				acceptance: [{ id: `acc-${taskId}`, assertion: "assert", verification: "bun test" }],
				risk: "material",
				revision: 1,
			};
			writeChildAudit(repo.root, taskId, "done", repo.baseHead, intent);
			mkdirSync(join(repo.root, "src"), { recursive: true });
			writeFileSync(join(repo.root, "src", "symlink.ts"), "code\n");

			mkdirSync(join(repo.root, ".imm", "state", "batches"), { recursive: true });
			const { symlinkSync } = await import("node:fs");
			symlinkSync(outsideDir, join(repo.root, ".imm", "state", "batches", "commits"));

			await expect(
				commitBatchChild({
					root: repo.root,
					taskId,
					batchId: "batch-symlink-1",
					expectedHead: repo.baseHead,
				}),
			).rejects.toThrow(/not a real directory|symlink/);

			expect(readFileSync(sensitiveFile, "utf8")).toBe("precious content\n");
		} finally {
			rmSync(outsideDir, { recursive: true, force: true });
		}
	});

	it("Finding 2: concurrent branch creation does not delete the existing branch", () => {
		const slug = "concurrent-branch";
		const branch = `imm/${slug}`;
		git(repo.root, ["branch", branch, repo.baseHead]);
		const branchCommitBefore = git(repo.root, ["rev-parse", `refs/heads/${branch}`]);

		const res = runBatchGitPreflight({
			root: repo.root,
			initiative_slug: slug,
			base_head: repo.baseHead,
		});

		expect(res.ok).toBe(false);
		expect(res.reason).toBe("batch_branch_exists");

		const branchCommitAfter = git(repo.root, ["rev-parse", `refs/heads/${branch}`]);
		expect(branchCommitAfter).toBe(branchCommitBefore);
	});

	it("Finding 1: resumeBatch rejects an in-scope external commit lacking durable batch evidence as failed", async () => {
		const slug = "fake-inscope-flow";
		const taskA = "task-fake-inscope";
		const intentPathA = writeTaskIntent(repo.root, taskA, "Goal", [
			"src/a.ts",
			`docs/plans/archive/${taskA}.intent.json`,
		]);

		git(repo.root, ["add", "docs/plans"]);
		git(repo.root, ["commit", "-m", "add intent file"]);
		repo.baseHead = git(repo.root, ["rev-parse", "HEAD"]);

		const children: BatchPlanChild[] = [
			{
				task_id: taskA,
				slice_id: "S1",
				blocked_by: [],
				status: "enrollable",
				reason: null,
				intent_path: intentPathA,
				intent_revision: 1,
				intent_content_hash: "a".repeat(64),
			},
		];

		runBatchGitPreflight({ root: repo.root, initiative_slug: slug, base_head: repo.baseHead });

		writeChildAudit(repo.root, taskA, "done", repo.baseHead, {
			contract: "assurance_kernel/task_intent/v1",
			task_id: taskA,
			owner: "user",
			goal: "Goal",
			scope_hint: ["src/a.ts", `docs/plans/archive/${taskA}.intent.json`],
			acceptance: [{ id: `acc-${taskA}`, assertion: "assert", verification: "bun test" }],
			risk: "material",
			revision: 1,
		});

		mkdirSync(join(repo.root, "src"), { recursive: true });
		writeFileSync(join(repo.root, "src", "a.ts"), "content\n");
		git(repo.root, ["add", "src/a.ts"]);
		const forgedMsg = `imm(${taskA}): Goal\n\nImmune-Brain-Batch: batch-fake-inscope-1\n`;
		git(repo.root, [
			"-c",
			"user.name=Immune-Brain Batch",
			"-c",
			"user.email=immune-brain@local",
			"commit",
			"-m",
			forgedMsg,
		]);

		const kernel: BatchRunnerKernelPort = {
			async enrollTask() {
				throw new Error("not called");
			},
			async advanceTask() {
				return { state: "completed" };
			},
			async projectTask(_root, taskId) {
				return {
					contract: "assurance_kernel/assurance_projection/v1",
					task_id: taskId,
					error: null,
					claim: { task_id: taskId, lifecycle_status: "active" },
					projection: { lifecycle: "done", completion_ready: true } as never,
				};
			},
			ownsTaskClaim() {
				return true;
			},
			validateBatchAuthorization(input) {
				return input.registry.inspect(input.capability, input.binding);
			},
		};

		const batchInput = makeBatchInput(children, kernel, slug, "batch-fake-inscope-1");

		const stateRecord = {
			contract: "assurance_kernel/batch_run_state/v1" as const,
			batch_id: "batch-fake-inscope-1",
			initiative_slug: slug,
			plan_digest: batchInput.plan_digest,
			base_head: repo.baseHead,
			branch: `imm/${slug}`,
			confirmation_time: CONFIRMATION_TIME,
			authorization_expires_at: FAR_FUTURE,
			budget: { max_children: 5, deadline_at: FAR_FUTURE, qa_failure_limit: 3 },
			batch_state: "running" as const,
			children: [
				{
					task_id: taskA,
					slice_id: "S1",
					blocked_by: [],
					state: "settled" as const,
					reason: null,
					commit: null,
				},
			],
			consecutive_qa_failures: 0,
			commits: [],
			created_at: CONFIRMATION_TIME,
			updated_at: CONFIRMATION_TIME,
		};
		const { writeBatchRunState } = await import("../plugins/immune-brain/runtime/unattended/batch_state");
		writeBatchRunState(repo.root, stateRecord);

		const report = await resumeBatch(batchInput, kernel.projectTask.bind(kernel));

		expect(report.batch_state).toBe("failed");
		expect(report.reason).toContain("batch_head_lineage_broken");

		const stored = readBatchRunState(repo.root, "batch-fake-inscope-1");
		expect(stored!.batch_state).toBe("failed");
	});

	it("Finding 1: startBatch terminates as failed on post-commit persistence window external HEAD drift", async () => {
		const slug = "drift-window-flow";
		const taskA = "task-drift-window";
		const intentPathA = writeTaskIntent(repo.root, taskA, "Goal", [
			"src/a.ts",
			`docs/plans/archive/${taskA}.intent.json`,
		]);

		git(repo.root, ["add", "docs/plans"]);
		git(repo.root, ["commit", "-m", "add intent file"]);
		repo.baseHead = git(repo.root, ["rev-parse", "HEAD"]);

		const children: BatchPlanChild[] = [
			{
				task_id: taskA,
				slice_id: "S1",
				blocked_by: [],
				status: "enrollable",
				reason: null,
				intent_path: intentPathA,
				intent_revision: 1,
				intent_content_hash: "a".repeat(64),
			},
		];

		runBatchGitPreflight({ root: repo.root, initiative_slug: slug, base_head: repo.baseHead });

		// Settle and commit taskA
		mkdirSync(join(repo.root, "src"), { recursive: true });
		writeFileSync(join(repo.root, "src", "a.ts"), "content\n");
		writeChildAudit(repo.root, taskA, "done", repo.baseHead, {
			contract: "assurance_kernel/task_intent/v1",
			task_id: taskA,
			owner: "user",
			goal: "Goal",
			scope_hint: ["src/a.ts", `docs/plans/archive/${taskA}.intent.json`],
			acceptance: [{ id: `acc-${taskA}`, assertion: "assert", verification: "bun test" }],
			risk: "material",
			revision: 1,
		});

		const { commit } = await commitBatchChild({
			root: repo.root,
			taskId: taskA,
			batchId: "batch-window-1",
			expectedHead: repo.baseHead,
		});

		// External commit advances HEAD past commit before the batch finishes marking completed
		writeFileSync(join(repo.root, "external-drift.txt"), "drift\n");
		git(repo.root, ["add", "external-drift.txt"]);
		git(repo.root, ["commit", "-m", "external drift commit"]);

		const kernel: BatchRunnerKernelPort = {
			async enrollTask() {
				throw new Error("not called");
			},
			async advanceTask() {
				return { state: "completed" };
			},
			async projectTask(_root, taskId) {
				return {
					contract: "assurance_kernel/assurance_projection/v1",
					task_id: taskId,
					error: null,
					claim: null,
					projection: { lifecycle: "done", completion_ready: true } as never,
				};
			},
			ownsTaskClaim() {
				return false;
			},
			validateBatchAuthorization(input) {
				return input.registry.inspect(input.capability, input.binding);
			},
		};

		const batchInput = makeBatchInput(children, kernel, slug, "batch-window-1");

		// Persist state as if crash happened after commit but while state is still "running"
		const stateRecord = {
			contract: "assurance_kernel/batch_run_state/v1" as const,
			batch_id: "batch-window-1",
			initiative_slug: slug,
			plan_digest: batchInput.plan_digest,
			base_head: repo.baseHead,
			branch: `imm/${slug}`,
			confirmation_time: CONFIRMATION_TIME,
			authorization_expires_at: FAR_FUTURE,
			budget: { max_children: 5, deadline_at: FAR_FUTURE, qa_failure_limit: 3 },
			batch_state: "running" as const,
			children: [
				{
					task_id: taskA,
					slice_id: "S1",
					blocked_by: [],
					state: "committed" as const,
					reason: null,
					commit,
				},
			],
			consecutive_qa_failures: 0,
			commits: [commit],
			created_at: CONFIRMATION_TIME,
			updated_at: CONFIRMATION_TIME,
		};
		const { writeBatchRunState } = await import("../plugins/immune-brain/runtime/unattended/batch_state");
		writeBatchRunState(repo.root, stateRecord);

		const report = await startBatch(batchInput);

		expect(report.batch_state).toBe("failed");
		expect(report.reason).toContain("batch_head_lineage_broken");

		const stored = readBatchRunState(repo.root, "batch-window-1");
		expect(stored!.batch_state).toBe("failed");
	});

	it("review round 7: resumeBatch terminates as failed on same-SHA branch switch before settlement", async () => {
		const slug = "branch-switch-flow";
		const taskA = "task-branch-switch-a";
		const intentPathA = writeTaskIntent(repo.root, taskA, "Goal", [
			"src/a.ts",
			`docs/plans/archive/${taskA}.intent.json`,
		]);

		git(repo.root, ["add", "docs/plans"]);
		git(repo.root, ["commit", "-m", "add intent file"]);
		repo.baseHead = git(repo.root, ["rev-parse", "HEAD"]);

		const children: BatchPlanChild[] = [
			{
				task_id: taskA,
				slice_id: "S1",
				blocked_by: [],
				status: "enrollable",
				reason: null,
				intent_path: intentPathA,
				intent_revision: 1,
				intent_content_hash: "a".repeat(64),
			},
		];

		runBatchGitPreflight({ root: repo.root, initiative_slug: slug, base_head: repo.baseHead });

		// Settle taskA in audit; do NOT commit it yet (before settlement)
		mkdirSync(join(repo.root, "src"), { recursive: true });
		writeFileSync(join(repo.root, "src", "a.ts"), "content a\n");
		writeChildAudit(repo.root, taskA, "done", repo.baseHead, {
			contract: "assurance_kernel/task_intent/v1",
			task_id: taskA,
			owner: "user",
			goal: "Goal",
			scope_hint: ["src/a.ts", `docs/plans/archive/${taskA}.intent.json`],
			acceptance: [{ id: `acc-${taskA}`, assertion: "assert", verification: "bun test" }],
			risk: "material",
			revision: 1,
		});

		// Same-SHA branch switch away from the batch branch while the child is settled but uncommitted
		git(repo.root, ["checkout", "-b", "decoy-resume"]);

		const kernel: BatchRunnerKernelPort = {
			async enrollTask() {
				throw new Error("not called");
			},
			async advanceTask() {
				return { state: "completed" };
			},
			async projectTask(_root, taskId) {
				return {
					contract: "assurance_kernel/assurance_projection/v1",
					task_id: taskId,
					error: null,
					claim: { task_id: taskId, lifecycle_status: "active" },
					projection: { lifecycle: "done", completion_ready: true } as never,
				};
			},
			ownsTaskClaim() {
				return true;
			},
			validateBatchAuthorization(input) {
				return input.registry.inspect(input.capability, input.binding);
			},
		};

		const batchInput = makeBatchInput(children, kernel, slug, "batch-branch-switch-1");

		// Persist state as if crash happened after settlement before committed-persist
		const stateRecord = {
			contract: "assurance_kernel/batch_run_state/v1" as const,
			batch_id: "batch-branch-switch-1",
			initiative_slug: slug,
			plan_digest: batchInput.plan_digest,
			base_head: repo.baseHead,
			branch: `imm/${slug}`,
			confirmation_time: CONFIRMATION_TIME,
			authorization_expires_at: FAR_FUTURE,
			budget: { max_children: 5, deadline_at: FAR_FUTURE, qa_failure_limit: 3 },
			batch_state: "running" as const,
			children: [
				{
					task_id: taskA,
					slice_id: "S1",
					blocked_by: [],
					state: "settled" as const,
					reason: null,
					commit: null,
				},
			],
			consecutive_qa_failures: 0,
			commits: [],
			created_at: CONFIRMATION_TIME,
			updated_at: CONFIRMATION_TIME,
		};
		const { writeBatchRunState } = await import("../plugins/immune-brain/runtime/unattended/batch_state");
		writeBatchRunState(repo.root, stateRecord);

		const report = await resumeBatch(batchInput, kernel.projectTask.bind(kernel));

		expect(report.batch_state).toBe("failed");
		expect(report.reason).toContain("batch_head_lineage_broken");

		const stored = readBatchRunState(repo.root, "batch-branch-switch-1");
		expect(stored!.batch_state).toBe("failed");
	});

	it("review round 8: startBatch persists failed (not thrown) when a committed child's branch is switched", async () => {
		const slug = "switch-committed-flow";
		const taskA = "task-switch-committed";
		const intentPathA = writeTaskIntent(repo.root, taskA, "Goal", [
			"src/a.ts",
			`docs/plans/archive/${taskA}.intent.json`,
		]);

		git(repo.root, ["add", "docs/plans"]);
		git(repo.root, ["commit", "-m", "add intent file"]);
		repo.baseHead = git(repo.root, ["rev-parse", "HEAD"]);

		const children: BatchPlanChild[] = [
			{
				task_id: taskA,
				slice_id: "S1",
				blocked_by: [],
				status: "enrollable",
				reason: null,
				intent_path: intentPathA,
				intent_revision: 1,
				intent_content_hash: "a".repeat(64),
			},
		];

		runBatchGitPreflight({ root: repo.root, initiative_slug: slug, base_head: repo.baseHead });

		mkdirSync(join(repo.root, "src"), { recursive: true });
		writeFileSync(join(repo.root, "src", "a.ts"), "content\n");
		writeChildAudit(repo.root, taskA, "done", repo.baseHead, {
			contract: "assurance_kernel/task_intent/v1",
			task_id: taskA,
			owner: "user",
			goal: "Goal",
			scope_hint: ["src/a.ts", `docs/plans/archive/${taskA}.intent.json`],
			acceptance: [{ id: `acc-${taskA}`, assertion: "assert", verification: "bun test" }],
			risk: "material",
			revision: 1,
		});

		const { commit } = await commitBatchChild({
			root: repo.root,
			taskId: taskA,
			batchId: "batch-switch-committed-1",
			expectedHead: repo.baseHead,
		});

		// Same-SHA branch switch away from the batch branch after the child committed
		git(repo.root, ["checkout", "-b", "decoy-committed"]);

		const kernel: BatchRunnerKernelPort = {
			async enrollTask() {
				throw new Error("not called");
			},
			async advanceTask() {
				return { state: "completed" };
			},
			async projectTask(_root, taskId) {
				return {
					contract: "assurance_kernel/assurance_projection/v1",
					task_id: taskId,
					error: null,
					claim: null,
					projection: { lifecycle: "done", completion_ready: true } as never,
				};
			},
			ownsTaskClaim() {
				return false;
			},
			validateBatchAuthorization(input) {
				return input.registry.inspect(input.capability, input.binding);
			},
		};

		const batchInput = makeBatchInput(children, kernel, slug, "batch-switch-committed-1");

		const stateRecord = {
			contract: "assurance_kernel/batch_run_state/v1" as const,
			batch_id: "batch-switch-committed-1",
			initiative_slug: slug,
			plan_digest: batchInput.plan_digest,
			base_head: repo.baseHead,
			branch: `imm/${slug}`,
			confirmation_time: CONFIRMATION_TIME,
			authorization_expires_at: FAR_FUTURE,
			budget: { max_children: 5, deadline_at: FAR_FUTURE, qa_failure_limit: 3 },
			batch_state: "running" as const,
			children: [
				{
					task_id: taskA,
					slice_id: "S1",
					blocked_by: [],
					state: "committed" as const,
					reason: null,
					commit,
				},
			],
			consecutive_qa_failures: 0,
			commits: [commit],
			created_at: CONFIRMATION_TIME,
			updated_at: CONFIRMATION_TIME,
		};
		const { writeBatchRunState } = await import("../plugins/immune-brain/runtime/unattended/batch_state");
		writeBatchRunState(repo.root, stateRecord);

		// Must return a failed report, not throw an unhandled validation error
		const report = await startBatch(batchInput);
		expect(report.batch_state).toBe("failed");
		expect(report.reason).toContain("batch_head_lineage_broken");

		const stored = readBatchRunState(repo.root, "batch-switch-committed-1");
		expect(stored!.batch_state).toBe("failed");
	});

	it("review round 8: resumeBatch persists failed when HEAD regresses and the recorded commit becomes unreachable", async () => {
		const slug = "head-regress-flow";
		const taskA = "task-head-regress";
		const intentPathA = writeTaskIntent(repo.root, taskA, "Goal", [
			"src/a.ts",
			`docs/plans/archive/${taskA}.intent.json`,
		]);

		git(repo.root, ["add", "docs/plans"]);
		git(repo.root, ["commit", "-m", "add intent file"]);
		repo.baseHead = git(repo.root, ["rev-parse", "HEAD"]);

		const children: BatchPlanChild[] = [
			{
				task_id: taskA,
				slice_id: "S1",
				blocked_by: [],
				status: "enrollable",
				reason: null,
				intent_path: intentPathA,
				intent_revision: 1,
				intent_content_hash: "a".repeat(64),
			},
		];

		runBatchGitPreflight({ root: repo.root, initiative_slug: slug, base_head: repo.baseHead });

		mkdirSync(join(repo.root, "src"), { recursive: true });
		writeFileSync(join(repo.root, "src", "a.ts"), "content\n");
		writeChildAudit(repo.root, taskA, "done", repo.baseHead, {
			contract: "assurance_kernel/task_intent/v1",
			task_id: taskA,
			owner: "user",
			goal: "Goal",
			scope_hint: ["src/a.ts", `docs/plans/archive/${taskA}.intent.json`],
			acceptance: [{ id: `acc-${taskA}`, assertion: "assert", verification: "bun test" }],
			risk: "material",
			revision: 1,
		});

		const { commit } = await commitBatchChild({
			root: repo.root,
			taskId: taskA,
			batchId: "batch-head-regress-1",
			expectedHead: repo.baseHead,
		});

		// HEAD regression: recorded batch commit becomes unreachable from HEAD
		git(repo.root, ["reset", "--hard", "HEAD~1"]);

		const kernel: BatchRunnerKernelPort = {
			async enrollTask() {
				throw new Error("not called");
			},
			async advanceTask() {
				return { state: "completed" };
			},
			async projectTask(_root, taskId) {
				return {
					contract: "assurance_kernel/assurance_projection/v1",
					task_id: taskId,
					error: null,
					claim: null,
					projection: { lifecycle: "done", completion_ready: true } as never,
				};
			},
			ownsTaskClaim() {
				return false;
			},
			validateBatchAuthorization(input) {
				return input.registry.inspect(input.capability, input.binding);
			},
		};

		const batchInput = makeBatchInput(children, kernel, slug, "batch-head-regress-1");

		const stateRecord = {
			contract: "assurance_kernel/batch_run_state/v1" as const,
			batch_id: "batch-head-regress-1",
			initiative_slug: slug,
			plan_digest: batchInput.plan_digest,
			base_head: repo.baseHead,
			branch: `imm/${slug}`,
			confirmation_time: CONFIRMATION_TIME,
			authorization_expires_at: FAR_FUTURE,
			budget: { max_children: 5, deadline_at: FAR_FUTURE, qa_failure_limit: 3 },
			batch_state: "running" as const,
			children: [
				{
					task_id: taskA,
					slice_id: "S1",
					blocked_by: [],
					state: "committed" as const,
					reason: null,
					commit,
				},
			],
			consecutive_qa_failures: 0,
			commits: [commit],
			created_at: CONFIRMATION_TIME,
			updated_at: CONFIRMATION_TIME,
		};
		const { writeBatchRunState } = await import("../plugins/immune-brain/runtime/unattended/batch_state");
		writeBatchRunState(repo.root, stateRecord);

		// Must return a failed report, not throw an unhandled validation error
		const report = await resumeBatch(batchInput, kernel.projectTask.bind(kernel));
		expect(report.batch_state).toBe("failed");
		expect(report.reason).toContain("batch_head_lineage_broken");

		const stored = readBatchRunState(repo.root, "batch-head-regress-1");
		expect(stored!.batch_state).toBe("failed");
	});

	it("review round 9: startBatch fails a lineage-broken batch with an in-flight enrolled child (two-child)", async () => {
		const slug = "inflight-switch-flow";
		const taskA = "task-inflight-a";
		const taskB = "task-inflight-b";
		const intentPathA = writeTaskIntent(repo.root, taskA, "Goal A", [
			"src/a.ts",
			`docs/plans/archive/${taskA}.intent.json`,
		]);
		const intentPathB = writeTaskIntent(repo.root, taskB, "Goal B", [
			"src/b.ts",
			`docs/plans/archive/${taskB}.intent.json`,
		]);

		git(repo.root, ["add", "docs/plans"]);
		git(repo.root, ["commit", "-m", "add intent files"]);
		repo.baseHead = git(repo.root, ["rev-parse", "HEAD"]);

		const children: BatchPlanChild[] = [
			{
				task_id: taskA,
				slice_id: "S1",
				blocked_by: [],
				status: "enrollable",
				reason: null,
				intent_path: intentPathA,
				intent_revision: 1,
				intent_content_hash: "a".repeat(64),
			},
			{
				task_id: taskB,
				slice_id: "S2",
				blocked_by: [taskA],
				status: "enrollable",
				reason: null,
				intent_path: intentPathB,
				intent_revision: 1,
				intent_content_hash: "a".repeat(64),
			},
		];

		runBatchGitPreflight({ root: repo.root, initiative_slug: slug, base_head: repo.baseHead });

		mkdirSync(join(repo.root, "src"), { recursive: true });
		writeFileSync(join(repo.root, "src", "a.ts"), "content a\n");
		writeChildAudit(repo.root, taskA, "done", repo.baseHead, {
			contract: "assurance_kernel/task_intent/v1",
			task_id: taskA,
			owner: "user",
			goal: "Goal A",
			scope_hint: ["src/a.ts", `docs/plans/archive/${taskA}.intent.json`],
			acceptance: [{ id: `acc-${taskA}`, assertion: "assert", verification: "bun test" }],
			risk: "material",
			revision: 1,
		});

		const { commit } = await commitBatchChild({
			root: repo.root,
			taskId: taskA,
			batchId: "batch-inflight-1",
			expectedHead: repo.baseHead,
		});

		// Same-SHA branch switch away from the batch branch while child B is in-flight
		git(repo.root, ["checkout", "-b", "decoy-inflight"]);

		const kernel: BatchRunnerKernelPort = {
			async enrollTask() {
				throw new Error("not called");
			},
			async advanceTask() {
				return { state: "completed" };
			},
			async projectTask(_root, taskId) {
				return {
					contract: "assurance_kernel/assurance_projection/v1",
					task_id: taskId,
					error: null,
					claim: null,
					projection: { lifecycle: "done", completion_ready: true } as never,
				};
			},
			ownsTaskClaim() {
				return false;
			},
			validateBatchAuthorization(input) {
				return input.registry.inspect(input.capability, input.binding);
			},
		};

		const batchInput = makeBatchInput(children, kernel, slug, "batch-inflight-1");

		const stateRecord = {
			contract: "assurance_kernel/batch_run_state/v1" as const,
			batch_id: "batch-inflight-1",
			initiative_slug: slug,
			plan_digest: batchInput.plan_digest,
			base_head: repo.baseHead,
			branch: `imm/${slug}`,
			confirmation_time: CONFIRMATION_TIME,
			authorization_expires_at: FAR_FUTURE,
			budget: { max_children: 5, deadline_at: FAR_FUTURE, qa_failure_limit: 3 },
			batch_state: "running" as const,
			children: [
				{
					task_id: taskA,
					slice_id: "S1",
					blocked_by: [],
					state: "committed" as const,
					reason: null,
					commit,
				},
				{
					task_id: taskB,
					slice_id: "S2",
					blocked_by: [taskA],
					state: "enrolled" as const,
					reason: null,
					commit: null,
				},
			],
			consecutive_qa_failures: 0,
			commits: [commit],
			created_at: CONFIRMATION_TIME,
			updated_at: CONFIRMATION_TIME,
		};
		const { writeBatchRunState } = await import("../plugins/immune-brain/runtime/unattended/batch_state");
		writeBatchRunState(repo.root, stateRecord);

		// Must persist a failed report (in-flight child transitioned), not throw
		const report = await startBatch(batchInput);
		expect(report.batch_state).toBe("failed");
		expect(report.reason).toContain("batch_head_lineage_broken");

		const stored = readBatchRunState(repo.root, "batch-inflight-1");
		expect(stored!.batch_state).toBe("failed");
		expect(stored!.children.find((c) => c.task_id === taskA)!.state).toBe("committed");
		expect(stored!.children.find((c) => c.task_id === taskB)!.state).toBe("needs_human");
	});

	it("review round 9: resumeBatch fails a lineage-broken batch with an in-flight settled child (two-child)", async () => {
		const slug = "inflight-regress-flow";
		const taskA = "task-inflight-regress-a";
		const taskB = "task-inflight-regress-b";
		const intentPathA = writeTaskIntent(repo.root, taskA, "Goal A", [
			"src/a.ts",
			`docs/plans/archive/${taskA}.intent.json`,
		]);
		const intentPathB = writeTaskIntent(repo.root, taskB, "Goal B", [
			"src/b.ts",
			`docs/plans/archive/${taskB}.intent.json`,
		]);

		git(repo.root, ["add", "docs/plans"]);
		git(repo.root, ["commit", "-m", "add intent files"]);
		repo.baseHead = git(repo.root, ["rev-parse", "HEAD"]);

		const children: BatchPlanChild[] = [
			{
				task_id: taskA,
				slice_id: "S1",
				blocked_by: [],
				status: "enrollable",
				reason: null,
				intent_path: intentPathA,
				intent_revision: 1,
				intent_content_hash: "a".repeat(64),
			},
			{
				task_id: taskB,
				slice_id: "S2",
				blocked_by: [taskA],
				status: "enrollable",
				reason: null,
				intent_path: intentPathB,
				intent_revision: 1,
				intent_content_hash: "a".repeat(64),
			},
		];

		runBatchGitPreflight({ root: repo.root, initiative_slug: slug, base_head: repo.baseHead });

		mkdirSync(join(repo.root, "src"), { recursive: true });
		writeFileSync(join(repo.root, "src", "a.ts"), "content a\n");
		writeChildAudit(repo.root, taskA, "done", repo.baseHead, {
			contract: "assurance_kernel/task_intent/v1",
			task_id: taskA,
			owner: "user",
			goal: "Goal A",
			scope_hint: ["src/a.ts", `docs/plans/archive/${taskA}.intent.json`],
			acceptance: [{ id: `acc-${taskA}`, assertion: "assert", verification: "bun test" }],
			risk: "material",
			revision: 1,
		});

		const { commit } = await commitBatchChild({
			root: repo.root,
			taskId: taskA,
			batchId: "batch-inflight-2",
			expectedHead: repo.baseHead,
		});

		// Child B is legitimately settled in-flight: its audit pair exists so
		// the recovery path reaches commitBatchChild's own lineage check.
		writeChildAudit(repo.root, taskB, "done", commit, {
			contract: "assurance_kernel/task_intent/v1",
			task_id: taskB,
			owner: "user",
			goal: "Goal B",
			scope_hint: ["src/b.ts", `docs/plans/archive/${taskB}.intent.json`],
			acceptance: [{ id: `acc-${taskB}`, assertion: "assert", verification: "bun test" }],
			risk: "material",
			revision: 1,
		});

		// HEAD regression: recorded batch commit becomes unreachable while child B is settled in-flight
		git(repo.root, ["reset", "--hard", "HEAD~1"]);

		const kernel: BatchRunnerKernelPort = {
			async enrollTask() {
				throw new Error("not called");
			},
			async advanceTask() {
				return { state: "completed" };
			},
			async projectTask(_root, taskId) {
				return {
					contract: "assurance_kernel/assurance_projection/v1",
					task_id: taskId,
					error: null,
					claim: null,
					projection: { lifecycle: "done", completion_ready: true } as never,
				};
			},
			ownsTaskClaim() {
				return false;
			},
			validateBatchAuthorization(input) {
				return input.registry.inspect(input.capability, input.binding);
			},
		};

		const batchInput = makeBatchInput(children, kernel, slug, "batch-inflight-2");

		const stateRecord = {
			contract: "assurance_kernel/batch_run_state/v1" as const,
			batch_id: "batch-inflight-2",
			initiative_slug: slug,
			plan_digest: batchInput.plan_digest,
			base_head: repo.baseHead,
			branch: `imm/${slug}`,
			confirmation_time: CONFIRMATION_TIME,
			authorization_expires_at: FAR_FUTURE,
			budget: { max_children: 5, deadline_at: FAR_FUTURE, qa_failure_limit: 3 },
			batch_state: "running" as const,
			children: [
				{
					task_id: taskA,
					slice_id: "S1",
					blocked_by: [],
					state: "committed" as const,
					reason: null,
					commit,
				},
				{
					task_id: taskB,
					slice_id: "S2",
					blocked_by: [taskA],
					state: "settled" as const,
					reason: null,
					commit: null,
				},
			],
			consecutive_qa_failures: 0,
			commits: [commit],
			created_at: CONFIRMATION_TIME,
			updated_at: CONFIRMATION_TIME,
		};
		const { writeBatchRunState } = await import("../plugins/immune-brain/runtime/unattended/batch_state");
		writeBatchRunState(repo.root, stateRecord);

		// Must persist a failed report (in-flight child transitioned), not throw
		const report = await resumeBatch(batchInput, kernel.projectTask.bind(kernel));
		expect(report.batch_state).toBe("failed");
		expect(report.reason).toContain("batch_head_lineage_broken");

		const stored = readBatchRunState(repo.root, "batch-inflight-2");
		expect(stored!.batch_state).toBe("failed");
		expect(stored!.children.find((c) => c.task_id === taskA)!.state).toBe("committed");
		expect(stored!.children.find((c) => c.task_id === taskB)!.state).toBe("needs_human");
	});

	it("review round 10: external HEAD movement before a subsequent child's enrollment fails the batch", async () => {
		const slug = "enroll-drift-flow";
		const taskA = "task-enroll-drift-a";
		const taskB = "task-enroll-drift-b";
		const intentPathA = writeTaskIntent(repo.root, taskA, "Goal A", [
			"src/a.ts",
			`docs/plans/archive/${taskA}.intent.json`,
		]);
		const intentPathB = writeTaskIntent(repo.root, taskB, "Goal B", [
			"src/b.ts",
			`docs/plans/archive/${taskB}.intent.json`,
		]);

		git(repo.root, ["add", "docs/plans"]);
		git(repo.root, ["commit", "-m", "add intent files"]);
		repo.baseHead = git(repo.root, ["rev-parse", "HEAD"]);

		const children: BatchPlanChild[] = [
			{
				task_id: taskA,
				slice_id: "S1",
				blocked_by: [],
				status: "enrollable",
				reason: null,
				intent_path: intentPathA,
				intent_revision: 1,
				intent_content_hash: "a".repeat(64),
			},
			{
				task_id: taskB,
				slice_id: "S2",
				blocked_by: [taskA],
				status: "enrollable",
				reason: null,
				intent_path: intentPathB,
				intent_revision: 1,
				intent_content_hash: "a".repeat(64),
			},
		];

		const kernel: BatchRunnerKernelPort = {
			// Mirrors deriveChildEnrollment's HEAD binding check
			async enrollTask(args) {
				if (args.task_id === taskB) {
					// External HEAD movement after the pre-loop check, before B's enrollment
					git(repo.root, ["commit", "--allow-empty", "-qm", "external movement"]);
				}
				const currentHead = git(repo.root, ["rev-parse", "HEAD"]);
				if (currentHead !== args.batch.binding.expected_head) {
					throw new Error(
						`batch_head_lineage_broken: current HEAD ${currentHead} does not match enrollment expected_head ${args.batch.binding.expected_head}`,
					);
				}
				return { record_revision: "rev-1" };
			},
			async advanceTask(root, taskId) {
				if (taskId === taskA) {
					mkdirSync(join(root, "src"), { recursive: true });
					writeFileSync(join(root, "src", "a.ts"), "content a\n");
					writeChildAudit(root, taskA, "done", repo.baseHead, {
						contract: "assurance_kernel/task_intent/v1",
						task_id: taskA,
						owner: "user",
						goal: "Goal A",
						scope_hint: ["src/a.ts", `docs/plans/archive/${taskA}.intent.json`],
						acceptance: [{ id: `acc-${taskA}`, assertion: "assert", verification: "bun test" }],
						risk: "material",
						revision: 1,
					});
				}
				return { state: "completed" };
			},
			async projectTask(_root, taskId) {
				return {
					contract: "assurance_kernel/assurance_projection/v1",
					task_id: taskId,
					error: null,
					claim: null,
					projection: { lifecycle: "done", completion_ready: true } as never,
				};
			},
			ownsTaskClaim() {
				return false;
			},
			validateBatchAuthorization(input) {
				return input.registry.inspect(input.capability, input.binding);
			},
		};

		const batchInput = makeBatchInput(children, kernel, slug, "batch-enroll-drift-1");

		const report = await startBatch(batchInput);

		expect(report.batch_state).toBe("failed");
		expect(report.reason).toContain("batch_head_lineage_broken");

		const stored = readBatchRunState(repo.root, "batch-enroll-drift-1");
		expect(stored!.batch_state).toBe("failed");
		expect(stored!.children.find((c) => c.task_id === taskA)!.state).toBe("committed");
		expect(stored!.children.find((c) => c.task_id === taskB)!.state).toBe("needs_human");
	});

	it("review round 11: resumeBatch fails when the first enrolled child faces external HEAD drift", async () => {
		const slug = "enrolled-drift-flow";
		const taskA = "task-enrolled-drift";
		const intentPathA = writeTaskIntent(repo.root, taskA, "Goal", [
			"src/a.ts",
			`docs/plans/archive/${taskA}.intent.json`,
		]);

		git(repo.root, ["add", "docs/plans"]);
		git(repo.root, ["commit", "-m", "add intent file"]);
		repo.baseHead = git(repo.root, ["rev-parse", "HEAD"]);

		const children: BatchPlanChild[] = [
			{
				task_id: taskA,
				slice_id: "S1",
				blocked_by: [],
				status: "enrollable",
				reason: null,
				intent_path: intentPathA,
				intent_revision: 1,
				intent_content_hash: "a".repeat(64),
			},
		];

		runBatchGitPreflight({ root: repo.root, initiative_slug: slug, base_head: repo.baseHead });

		// External HEAD movement after the initial check, while child A is enrolled
		git(repo.root, ["commit", "--allow-empty", "-qm", "external movement"]);

		const kernel: BatchRunnerKernelPort = {
			async enrollTask() {
				throw new Error("not called");
			},
			async advanceTask() {
				throw new Error("not called");
			},
			async projectTask(_root, taskId) {
				return {
					contract: "assurance_kernel/assurance_projection/v1",
					task_id: taskId,
					error: null,
					claim: null,
					projection: { lifecycle: "active", completion_ready: false } as never,
				};
			},
			ownsTaskClaim() {
				return false;
			},
			validateBatchAuthorization(input) {
				return input.registry.inspect(input.capability, input.binding);
			},
		};

		const batchInput = makeBatchInput(children, kernel, slug, "batch-enrolled-drift-1");

		const stateRecord = {
			contract: "assurance_kernel/batch_run_state/v1" as const,
			batch_id: "batch-enrolled-drift-1",
			initiative_slug: slug,
			plan_digest: batchInput.plan_digest,
			base_head: repo.baseHead,
			branch: `imm/${slug}`,
			confirmation_time: CONFIRMATION_TIME,
			authorization_expires_at: FAR_FUTURE,
			budget: { max_children: 5, deadline_at: FAR_FUTURE, qa_failure_limit: 3 },
			batch_state: "running" as const,
			children: [
				{
					task_id: taskA,
					slice_id: "S1",
					blocked_by: [],
					state: "enrolled" as const,
					reason: null,
					commit: null,
				},
			],
			consecutive_qa_failures: 0,
			commits: [],
			created_at: CONFIRMATION_TIME,
			updated_at: CONFIRMATION_TIME,
		};
		const { writeBatchRunState } = await import("../plugins/immune-brain/runtime/unattended/batch_state");
		writeBatchRunState(repo.root, stateRecord);

		const report = await resumeBatch(batchInput, kernel.projectTask.bind(kernel));
		expect(report.batch_state).toBe("failed");
		expect(report.reason).toContain("batch_head_lineage_broken");

		const stored = readBatchRunState(repo.root, "batch-enrolled-drift-1");
		expect(stored!.batch_state).toBe("failed");
		expect(stored!.children.find((c) => c.task_id === taskA)!.state).toBe("needs_human");
	});

	it("review round 11: resumeBatch fails when the first enrolled child faces a same-SHA branch switch", async () => {
		const slug = "enrolled-switch-flow";
		const taskA = "task-enrolled-switch";
		const intentPathA = writeTaskIntent(repo.root, taskA, "Goal", [
			"src/a.ts",
			`docs/plans/archive/${taskA}.intent.json`,
		]);

		git(repo.root, ["add", "docs/plans"]);
		git(repo.root, ["commit", "-m", "add intent file"]);
		repo.baseHead = git(repo.root, ["rev-parse", "HEAD"]);

		const children: BatchPlanChild[] = [
			{
				task_id: taskA,
				slice_id: "S1",
				blocked_by: [],
				status: "enrollable",
				reason: null,
				intent_path: intentPathA,
				intent_revision: 1,
				intent_content_hash: "a".repeat(64),
			},
		];

		runBatchGitPreflight({ root: repo.root, initiative_slug: slug, base_head: repo.baseHead });

		// Same-SHA branch switch while child A is enrolled
		git(repo.root, ["checkout", "-b", "decoy-enrolled"]);

		const kernel: BatchRunnerKernelPort = {
			async enrollTask() {
				throw new Error("not called");
			},
			async advanceTask() {
				throw new Error("not called");
			},
			async projectTask(_root, taskId) {
				return {
					contract: "assurance_kernel/assurance_projection/v1",
					task_id: taskId,
					error: null,
					claim: null,
					projection: { lifecycle: "active", completion_ready: false } as never,
				};
			},
			ownsTaskClaim() {
				return false;
			},
			validateBatchAuthorization(input) {
				return input.registry.inspect(input.capability, input.binding);
			},
		};

		const batchInput = makeBatchInput(children, kernel, slug, "batch-enrolled-switch-1");

		const stateRecord = {
			contract: "assurance_kernel/batch_run_state/v1" as const,
			batch_id: "batch-enrolled-switch-1",
			initiative_slug: slug,
			plan_digest: batchInput.plan_digest,
			base_head: repo.baseHead,
			branch: `imm/${slug}`,
			confirmation_time: CONFIRMATION_TIME,
			authorization_expires_at: FAR_FUTURE,
			budget: { max_children: 5, deadline_at: FAR_FUTURE, qa_failure_limit: 3 },
			batch_state: "running" as const,
			children: [
				{
					task_id: taskA,
					slice_id: "S1",
					blocked_by: [],
					state: "enrolled" as const,
					reason: null,
					commit: null,
				},
			],
			consecutive_qa_failures: 0,
			commits: [],
			created_at: CONFIRMATION_TIME,
			updated_at: CONFIRMATION_TIME,
		};
		const { writeBatchRunState } = await import("../plugins/immune-brain/runtime/unattended/batch_state");
		writeBatchRunState(repo.root, stateRecord);

		const report = await resumeBatch(batchInput, kernel.projectTask.bind(kernel));
		expect(report.batch_state).toBe("failed");
		expect(report.reason).toContain("batch_head_lineage_broken");

		const stored = readBatchRunState(repo.root, "batch-enrolled-switch-1");
		expect(stored!.batch_state).toBe("failed");
		expect(stored!.children.find((c) => c.task_id === taskA)!.state).toBe("needs_human");
	});

	it("review round 12: resumeBatch adopts a verified own commit for a settled child without external drift", async () => {
		const slug = "adopt-flow";
		const taskA = "task-adopt-a";
		const taskB = "task-adopt-b";
		const intentPathA = writeTaskIntent(repo.root, taskA, "Goal A", [
			"src/a.ts",
			`docs/plans/archive/${taskA}.intent.json`,
		]);
		const intentPathB = writeTaskIntent(repo.root, taskB, "Goal B", [
			"src/b.ts",
			`docs/plans/archive/${taskB}.intent.json`,
		]);

		git(repo.root, ["add", "docs/plans"]);
		git(repo.root, ["commit", "-m", "add intent files"]);
		repo.baseHead = git(repo.root, ["rev-parse", "HEAD"]);

		const children: BatchPlanChild[] = [
			{
				task_id: taskA,
				slice_id: "S1",
				blocked_by: [],
				status: "enrollable",
				reason: null,
				intent_path: intentPathA,
				intent_revision: 1,
				intent_content_hash: "a".repeat(64),
			},
			{
				task_id: taskB,
				slice_id: "S2",
				blocked_by: [taskA],
				status: "enrollable",
				reason: null,
				intent_path: intentPathB,
				intent_revision: 1,
				intent_content_hash: "a".repeat(64),
			},
		];

		runBatchGitPreflight({ root: repo.root, initiative_slug: slug, base_head: repo.baseHead });

		// Commit A with durable evidence, then crash before committed-persist:
		// state still shows settled with commits [] and no external HEAD movement.
		mkdirSync(join(repo.root, "src"), { recursive: true });
		writeFileSync(join(repo.root, "src", "a.ts"), "content a\n");
		writeChildAudit(repo.root, taskA, "done", repo.baseHead, {
			contract: "assurance_kernel/task_intent/v1",
			task_id: taskA,
			owner: "user",
			goal: "Goal A",
			scope_hint: ["src/a.ts", `docs/plans/archive/${taskA}.intent.json`],
			acceptance: [{ id: `acc-${taskA}`, assertion: "assert", verification: "bun test" }],
			risk: "material",
			revision: 1,
		});
		const shaA = (await commitBatchChild({
			root: repo.root,
			taskId: taskA,
			batchId: "batch-adopt-1",
			expectedHead: repo.baseHead,
		})).commit;

		const kernel: BatchRunnerKernelPort = {
			async enrollTask() {
				return { record_revision: "rev-1" };
			},
			async advanceTask(root, taskId) {
				if (taskId === taskA) {
					throw new Error("adopted child must not be re-driven");
				}
				mkdirSync(join(root, "src"), { recursive: true });
				writeFileSync(join(root, "src", "b.ts"), "content b\n");
				const headNow = git(root, ["rev-parse", "HEAD"]);
				writeChildAudit(root, taskId, "done", headNow, {
					contract: "assurance_kernel/task_intent/v1",
					task_id: taskId,
					owner: "user",
					goal: "Goal B",
					scope_hint: ["src/b.ts", `docs/plans/archive/${taskB}.intent.json`],
					acceptance: [{ id: `acc-${taskB}`, assertion: "assert", verification: "bun test" }],
					risk: "material",
					revision: 1,
				});
				return { state: "completed" };
			},
			async projectTask(_root, taskId) {
				return {
					contract: "assurance_kernel/assurance_projection/v1",
					task_id: taskId,
					error: null,
					claim: null,
					projection: { lifecycle: "done", completion_ready: true } as never,
				};
			},
			ownsTaskClaim() {
				return true;
			},
			validateBatchAuthorization(input) {
				return input.registry.inspect(input.capability, input.binding);
			},
		};

		const batchInput = makeBatchInput(children, kernel, slug, "batch-adopt-1");

		const stateRecord = {
			contract: "assurance_kernel/batch_run_state/v1" as const,
			batch_id: "batch-adopt-1",
			initiative_slug: slug,
			plan_digest: batchInput.plan_digest,
			base_head: repo.baseHead,
			branch: `imm/${slug}`,
			confirmation_time: CONFIRMATION_TIME,
			authorization_expires_at: FAR_FUTURE,
			budget: { max_children: 5, deadline_at: FAR_FUTURE, qa_failure_limit: 3 },
			batch_state: "running" as const,
			children: [
				{
					task_id: taskA,
					slice_id: "S1",
					blocked_by: [],
					state: "settled" as const,
					reason: null,
					commit: null,
				},
				{
					task_id: taskB,
					slice_id: "S2",
					blocked_by: [taskA],
					state: "pending" as const,
					reason: null,
					commit: null,
				},
			],
			consecutive_qa_failures: 0,
			commits: [],
			created_at: CONFIRMATION_TIME,
			updated_at: CONFIRMATION_TIME,
		};
		const { writeBatchRunState } = await import("../plugins/immune-brain/runtime/unattended/batch_state");
		writeBatchRunState(repo.root, stateRecord);

		const report = await resumeBatch(batchInput, kernel.projectTask.bind(kernel));

		expect(report.batch_state).toBe("completed");
		const stored = readBatchRunState(repo.root, "batch-adopt-1");
		expect(stored!.batch_state).toBe("completed");
		// The original SHA is adopted, never re-committed
		expect(stored!.children.find((c) => c.task_id === taskA)!.commit).toBe(shaA);
		expect(stored!.commits).toEqual([shaA, stored!.children.find((c) => c.task_id === taskB)!.commit]);
		expect(git(repo.root, ["rev-list", "HEAD"]).split("\n")).toContain(shaA);
	});

	it("review round 13: lookupBatchCommit finds its own commit under grep.extendedRegexp=true", async () => {
		const slug = "extended-grep-flow";
		const taskId = "task-extended-grep";
		const intent = {
			contract: "assurance_kernel/task_intent/v1",
			task_id: taskId,
			owner: "user",
			goal: "Extended regexp goal",
			scope_hint: ["src/allowed.ts"],
			acceptance: [{ id: `acc-${taskId}`, assertion: "assert", verification: "bun test" }],
			risk: "material",
			revision: 1,
		};
		runBatchGitPreflight({ root: repo.root, initiative_slug: slug, base_head: repo.baseHead });
		writeChildAudit(repo.root, taskId, "done", repo.baseHead, intent);
		mkdirSync(join(repo.root, "src"), { recursive: true });
		writeFileSync(join(repo.root, "src", "allowed.ts"), "allowed\n");

		const res = await commitBatchChild({
			root: repo.root,
			taskId,
			batchId: "batch-extended-grep",
			expectedHead: repo.baseHead,
		});

		git(repo.root, ["config", "grep.extendedRegexp", "true"]);
		const found = await lookupBatchCommit({
			root: repo.root,
			taskId,
			batchId: "batch-extended-grep",
			expectedHead: repo.baseHead,
			branch: `imm/${slug}`,
		});
		expect(found).not.toBeNull();
		expect(found!.commit).toBe(res.commit);
	});

	it("review round 14: evidence-direct lookup is not shadowed by a later goal mentioning the marker", async () => {
		const slug = "shadow-flow";
		const taskA = "task-shadow-a";
		runBatchGitPreflight({ root: repo.root, initiative_slug: slug, base_head: repo.baseHead });

		const intentA = {
			contract: "assurance_kernel/task_intent/v1",
			task_id: taskA,
			owner: "user",
			goal: "Validation goal",
			scope_hint: ["src/a.ts"],
			acceptance: [{ id: `acc-${taskA}`, assertion: "assert", verification: "bun test" }],
			risk: "material",
			revision: 1,
		};
		writeChildAudit(repo.root, taskA, "done", repo.baseHead, intentA);
		mkdirSync(join(repo.root, "src"), { recursive: true });
		writeFileSync(join(repo.root, "src", "a.ts"), "a\n");
		const shaA = (await commitBatchChild({
			root: repo.root,
			taskId: taskA,
			batchId: "batch-shadow-1",
			expectedHead: repo.baseHead,
		})).commit;

		// Child B's goal text mentions A's marker; its commit must not shadow A's
		const taskB = "task-shadow-b";
		const intentB = {
			contract: "assurance_kernel/task_intent/v1",
			task_id: taskB,
			owner: "user",
			goal: `Follow up imm(${taskA}): validation`,
			scope_hint: ["src/b.ts"],
			acceptance: [{ id: `acc-${taskB}`, assertion: "assert", verification: "bun test" }],
			risk: "material",
			revision: 1,
		};
		const headAfterA = git(repo.root, ["rev-parse", "HEAD"]);
		writeChildAudit(repo.root, taskB, "done", headAfterA, intentB);
		writeFileSync(join(repo.root, "src", "b.ts"), "b\n");
		const shaB = (await commitBatchChild({
			root: repo.root,
			taskId: taskB,
			batchId: "batch-shadow-1",
			expectedHead: headAfterA,
		})).commit;
		expect(shaB).not.toBe(shaA);

		const foundA = await lookupBatchCommit({ root: repo.root, taskId: taskA, batchId: "batch-shadow-1" });
		expect(foundA).not.toBeNull();
		expect(foundA!.commit).toBe(shaA);

		const foundB = await lookupBatchCommit({ root: repo.root, taskId: taskB, batchId: "batch-shadow-1" });
		expect(foundB).not.toBeNull();
		expect(foundB!.commit).toBe(shaB);
	});

	it("review round 15: preflight rejects a hidden dirty out-of-scope submodule (submodule.ignore=all)", () => {
		const srcRepo = mkdtempSync(join(tmpdir(), "sub-src-"));
		try {
			git(srcRepo, ["init", "-q"]);
			git(srcRepo, ["config", "user.name", "T"]);
			git(srcRepo, ["config", "user.email", "t@t"]);
			writeFileSync(join(srcRepo, "f.txt"), "1\n");
			git(srcRepo, ["add", "f.txt"]);
			git(srcRepo, ["commit", "-qm", "init"]);

			git(repo.root, ["-c", "protocol.file.allow=always", "submodule", "add", srcRepo, "vendor/sub"]);
			git(repo.root, ["commit", "-qm", "add submodule"]);
			const baseNow = git(repo.root, ["rev-parse", "HEAD"]);
			git(repo.root, ["config", "submodule.vendor/sub.ignore", "all"]);

			// Dirty the submodule's tracked content; hidden by ignore=all
			writeFileSync(join(repo.root, "vendor", "sub", "f.txt"), "2\n");

			const res = runBatchGitPreflight({
				root: repo.root,
				initiative_slug: "sub-hidden-a",
				base_head: baseNow,
			});
			expect(res.ok).toBe(false);
			if (!res.ok) {
				expect(res.reason).toBe("dirty_working_tree");
			}
			expect(existsSync(join(repo.root, ".imm", "state", "batches"))).toBe(false);
		} finally {
			rmSync(srcRepo, { recursive: true, force: true });
		}
	});

	it("review round 15: commitBatchChild rejects a hidden dirty out-of-scope submodule as dirty_outside_scope", async () => {
		const slug = "sub-hidden-b";
		const srcRepo = mkdtempSync(join(tmpdir(), "sub-src-"));
		try {
			git(srcRepo, ["init", "-q"]);
			git(srcRepo, ["config", "user.name", "T"]);
			git(srcRepo, ["config", "user.email", "t@t"]);
			writeFileSync(join(srcRepo, "f.txt"), "1\n");
			git(srcRepo, ["add", "f.txt"]);
			git(srcRepo, ["commit", "-qm", "init"]);

			git(repo.root, ["-c", "protocol.file.allow=always", "submodule", "add", srcRepo, "vendor/sub"]);
			git(repo.root, ["commit", "-qm", "add submodule"]);
			const baseNow = git(repo.root, ["rev-parse", "HEAD"]);
			git(repo.root, ["config", "submodule.vendor/sub.ignore", "all"]);

			runBatchGitPreflight({ root: repo.root, initiative_slug: slug, base_head: baseNow });

			// In-scope change plus a hidden dirty out-of-scope submodule
			const taskId = "task-sub-hidden";
			writeChildAudit(repo.root, taskId, "done", baseNow, {
				contract: "assurance_kernel/task_intent/v1",
				task_id: taskId,
				owner: "user",
				goal: "Sub hidden goal",
				scope_hint: ["src/allowed.ts"],
				acceptance: [{ id: `acc-${taskId}`, assertion: "assert", verification: "bun test" }],
				risk: "material",
				revision: 1,
			});
			mkdirSync(join(repo.root, "src"), { recursive: true });
			writeFileSync(join(repo.root, "src", "allowed.ts"), "allowed\n");
			writeFileSync(join(repo.root, "vendor", "sub", "f.txt"), "2\n");

			await expect(
				commitBatchChild({
					root: repo.root,
					taskId,
					batchId: "batch-sub-hidden-1",
					expectedHead: baseNow,
				}),
			).rejects.toThrow("dirty_outside_scope");
		} finally {
			rmSync(srcRepo, { recursive: true, force: true });
		}
	});

	it("review round 16: rejects an in-scope dirty submodule whose contents git add cannot stage", async () => {
		const slug = "sub-inscope-flow";
		const srcRepo = mkdtempSync(join(tmpdir(), "sub-src-"));
		try {
			git(srcRepo, ["init", "-q"]);
			git(srcRepo, ["config", "user.name", "T"]);
			git(srcRepo, ["config", "user.email", "t@t"]);
			writeFileSync(join(srcRepo, "f.txt"), "1\n");
			git(srcRepo, ["add", "f.txt"]);
			git(srcRepo, ["commit", "-qm", "init"]);

			git(repo.root, ["-c", "protocol.file.allow=always", "submodule", "add", srcRepo, "vendor/sub"]);
			git(repo.root, ["commit", "-qm", "add submodule"]);
			const baseNow = git(repo.root, ["rev-parse", "HEAD"]);

			runBatchGitPreflight({ root: repo.root, initiative_slug: slug, base_head: baseNow });

			// Scope INCLUDES the submodule; the child modifies tracked content
			// inside it without committing there, plus an in-scope parent file.
			const taskId = "task-sub-inscope";
			writeChildAudit(repo.root, taskId, "done", baseNow, {
				contract: "assurance_kernel/task_intent/v1",
				task_id: taskId,
				owner: "user",
				goal: "Sub inscope goal",
				scope_hint: ["src/allowed.ts", "vendor/sub"],
				acceptance: [{ id: `acc-${taskId}`, assertion: "assert", verification: "bun test" }],
				risk: "material",
				revision: 1,
			});
			mkdirSync(join(repo.root, "src"), { recursive: true });
			writeFileSync(join(repo.root, "src", "allowed.ts"), "allowed\n");
			writeFileSync(join(repo.root, "vendor", "sub", "f.txt"), "2\n");

			await expect(
				commitBatchChild({
					root: repo.root,
					taskId,
					batchId: "batch-sub-inscope-1",
					expectedHead: baseNow,
				}),
			).rejects.toThrow(/residual unstaged changes/);

			// Nothing was committed and no evidence was produced
			expect(git(repo.root, ["rev-parse", "HEAD"])).toBe(
				git(repo.root, ["rev-parse", `imm/${slug}`]),
			);
			expect(existsSync(join(repo.root, ".imm", "state", "batches", "commits", "batch-sub-inscope-1-task-sub-inscope.json"))).toBe(false);
		} finally {
			rmSync(srcRepo, { recursive: true, force: true });
		}
	});
});
