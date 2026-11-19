// Two-tier proof-based cleanup (Spec unified-lane-sessions D11, S6).
// SLC-A1: per-child closeWithProof removes the integrated child's worktree and
// imm-lane branch, recording lane_removed; the batch branch is deleted only
// after whole-batch checkout_delivery success. SLC-A2: every failed proof or
// Git condition retains with batch_lane_retained naming the condition;
// parked, stopped and redo Lanes are never removed.
import { afterAll, describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cleanupOneIntegratedChild, createDefaultLaneGitPort, retainedLaneNotices } from "../plugins/immune-brain/runtime/unattended/batch_lanes";
import { cleanupIntegratedChildLane, cleanupParentBranch, retainedLaneReason } from "../plugins/immune-brain/runtime/unattended/lane_cleanup";
import type { BatchSessionPort } from "../plugins/immune-brain/runtime/unattended/batch_session_port";
import { computeBatchPlanDigest, createBatchAuthorityRegistry } from "../plugins/immune-brain/runtime/kernel/batch_authority";
import { canonicalIntentHash, readTaskIntent } from "../plugins/immune-brain/runtime/kernel/intent";
import type { AssuranceProjectionResult } from "../plugins/immune-brain/runtime/kernel/assurance_projection";
import type { BatchRunnerKernelPort, StartBatchInput } from "../plugins/immune-brain/runtime/unattended/batch_runner";
import { startBatch } from "../plugins/immune-brain/runtime/unattended/batch_runner";
import { createDefaultBatchGitPort } from "../plugins/immune-brain/runtime/unattended/batch_git";
import { readAnyBatchRunState, prepareBatchLaneRunState, writeBatchLaneRunState } from "../plugins/immune-brain/runtime/unattended/batch_state";
import type { BatchPlanChild } from "../plugins/immune-brain/runtime/unattended/types";

const roots: string[] = [];
afterAll(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });

function git(cwd: string, ...args: string[]): string {
	return execFileSync("git", ["-C", cwd, "-c", "user.name=T", "-c", "user.email=t@t", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function provenPort(handle: string, key: string): BatchSessionPort {
	return {
		provider: "fake",
		open: async () => ({ ok: true, handle, entry_submitted: true }),
		resume: async () => ({ ok: true, entry_submitted: true }),
		find: async () => ({ ok: true, handle }),
		observe: async () => ({ ok: true, state: "exited" as const }),
		send: async () => ({ ok: true, state: "exited" as const }),
		stop: async () => ({ ok: true }),
		closeWithProof: async (h, k) => (h === handle && k === key
			? { ok: true, exited: true as const, handle, key }
			: { ok: false, code: "not_owned", reason: "handle was not created for this session key" }),
	};
}

function refusalPort(code: string, reason: string): BatchSessionPort {
	return {
		provider: "fake",
		open: async () => ({ ok: true, handle: "h", entry_submitted: true }),
		resume: async () => ({ ok: true, entry_submitted: true }),
		find: async () => ({ ok: true, not_found: true as const }),
		observe: async () => ({ ok: true, state: "unknown" as const }),
		send: async () => ({ ok: false, code, reason }),
		stop: async () => ({ ok: true }),
		closeWithProof: async () => ({ ok: false, code, reason }),
	};
}

function noProofPort(): BatchSessionPort {
	return {
		provider: "herdr-core",
		open: async () => ({ ok: true, handle: "h", entry_submitted: true }),
		resume: async () => ({ ok: true, entry_submitted: true }),
		find: async () => ({ ok: true, not_found: true as const }),
		observe: async () => ({ ok: true, state: "unknown" as const }),
		send: async () => ({ ok: false, code: "provider_unavailable", reason: "no proof" }),
		stop: async () => ({ ok: true }),
		closeWithProof: async () => ({ ok: false, code: "provider_unavailable", reason: "provider herdr-core has no close proof" }),
	};
}

/** A repo with a Parent branch and one Lane worktree whose tip is integrated. */
function fixture(slug: string, task: string) {
	const dir = realpathSync(mkdtempSync(join(tmpdir(), "imm-slc-")));
	roots.push(dir);
	const repo = join(dir, "repo"), lanePath = join(dir, "lane");
	mkdirSync(repo);
	writeFileSync(join(repo, "base.txt"), "base\n");
	git(repo, "init", "-q", "-b", "main");
	git(repo, "add", "-A"); git(repo, "commit", "-qm", "base");
	const laneBranch = `imm-lane/${slug}/${task}`;
	git(repo, "worktree", "add", "-q", "-b", laneBranch, lanePath);
	writeFileSync(join(lanePath, "delivery.txt"), "d\n");
	git(lanePath, "add", "-A"); git(lanePath, "commit", "-qm", "delivery");
	git(repo, "branch", `imm/${slug}`, laneBranch);
	const parentRef = `refs/heads/imm/${slug}`;
	const key = `imm-${task}-g1-abc123def456`;
	return { repo, lanePath, laneBranch, parentRef, key, task };
}

const branches = (repo: string) => git(repo, "for-each-ref", "--format=%(refname:short)", "refs/heads/imm-lane", "refs/heads/imm").split("\n").filter(Boolean);

describe("SLC-A1: proven closeWithProof removes the integrated Lane", () => {
	it("single-task checkout_delivery: closeWithProof closes the handle and cleanup removes worktree, imm-lane and imm, recording lane_removed", async () => {
		const f = fixture("task-a", "task-a");
		const handle = "h-single";
		const sessions = provenPort(handle, f.key);
		const child: Parameters<typeof cleanupOneIntegratedChild>[0]["child"] = {
			task_id: f.task, slice_id: "S1", blocked_by: [], state: "integrated", reason: null, commit: "c",
			lane: { path: f.lanePath, branch: f.laneBranch, base_head: "b", lane_commit: "c" },
			session: { key: f.key, generation: 1, baseline: "r", handle, entry_submitted: true, attention: null, no_progress: 0, exit_proof: null },
			qa_failures: 0,
		};
		const update = await cleanupOneIntegratedChild({ root: f.repo, branch: f.parentRef, child, sessions });
		expect(update?.lane_removed).toMatchObject({ worktree: f.lanePath, branches: [f.laneBranch] });
		expect(update?.lane_removed?.exit).toMatchObject({ ok: true, exited: true, handle, key: f.key });
		// Checkout staging would happen here (manual: stage delta); the worktree is already gone.
		expect(existsSync(f.lanePath)).toBe(false);
		expect(branches(f.repo)).toEqual(["imm/task-a"]);
		// Tier 2: whole-batch checkout_delivery success deletes the Parent branch.
		expect(cleanupParentBranch({ root: f.repo, parentRef: f.parentRef })).toEqual({ removed: true });
		expect(branches(f.repo)).toEqual([]);
	});

	it("Initiative retain_branch: Child 1 cleans up while Child 2 keeps running and the shared Parent branch stays", async () => {
		const dir = realpathSync(mkdtempSync(join(tmpdir(), "imm-slc-two-")));
		roots.push(dir);
		const repo = join(dir, "repo");
		mkdirSync(repo);
		writeFileSync(join(repo, "base.txt"), "base\n");
		git(repo, "init", "-q", "-b", "main");
		git(repo, "add", "-A"); git(repo, "commit", "-qm", "base");
		const mk = (task: string) => {
			const p = join(dir, task);
			const b = `imm-lane/slug/${task}`;
			git(repo, "worktree", "add", "-q", "-b", b, p);
			writeFileSync(join(p, `${task}.txt`), "d\n");
			git(p, "add", "-A"); git(p, "commit", "-qm", task);
			return { p, b };
		};
		const c1 = mk("child-1"), c2 = mk("child-2");
		git(repo, "branch", "imm/slug", c1.b);
		const parentRef = "refs/heads/imm/slug";
		const key1 = "imm-child-1-g1-aaa111bbb222";
		const sessions = provenPort("h1", key1);
		const child1: Parameters<typeof cleanupOneIntegratedChild>[0]["child"] = {
			task_id: "child-1", slice_id: "S1", blocked_by: [], state: "integrated", reason: null, commit: "c1",
			lane: { path: c1.p, branch: c1.b, base_head: "b", lane_commit: "c1" },
			session: { key: key1, generation: 1, baseline: "r", handle: "h1", entry_submitted: true, attention: null, no_progress: 0, exit_proof: null },
			qa_failures: 0,
		};
		const update = await cleanupOneIntegratedChild({ root: repo, branch: parentRef, child: child1, sessions });
		expect(update?.lane_removed?.branches).toEqual([c1.b]);
		expect(existsSync(c1.p)).toBe(false);
		expect(branches(repo).sort()).toEqual(["imm-lane/slug/child-2", "imm/slug"]);
		// Child 2's Lane/session and the shared Parent branch remain intact.
		expect(existsSync(c2.p)).toBe(true);
		expect(git(repo, "rev-parse", "--verify", "--quiet", "refs/heads/imm/slug")).not.toBe("");
	});
});

describe("SLC-A2: failed proof or Git conditions retain with batch_lane_retained", () => {
	it("provider with exit_proof false keeps the Lane", async () => {
		const f = fixture("t", "t");
		const child: Parameters<typeof cleanupOneIntegratedChild>[0]["child"] = {
			task_id: "t", slice_id: "S1", blocked_by: [], state: "integrated", reason: null, commit: "c",
			lane: { path: f.lanePath, branch: f.laneBranch, base_head: "b", lane_commit: "c" },
			session: { key: f.key, generation: 1, baseline: "r", handle: "h", entry_submitted: true, attention: null, no_progress: 0, exit_proof: null },
			qa_failures: 0,
		};
		const update = await cleanupOneIntegratedChild({ root: f.repo, branch: f.parentRef, child, sessions: noProofPort() });
		expect(update?.lane_retained?.condition).toContain("provider herdr-core has no close proof");
		expect(retainedLaneReason(update!.lane_retained!.condition)).toContain("batch_lane_retained");
		expect(existsSync(f.lanePath)).toBe(true);
		expect(branches(f.repo).sort()).toEqual([f.laneBranch, "imm/t"]);
	});

	for (const [code, reason] of [["unknown", "the session state is unknown"], ["timeout", "await timed out"], ["events_lost", "the provider dropped events"]] as const) {
		it(`unproven closeWithProof (${code}) keeps the Lane`, async () => {
			const f = fixture("t", "t");
			const child: Parameters<typeof cleanupOneIntegratedChild>[0]["child"] = {
				task_id: "t", slice_id: "S1", blocked_by: [], state: "integrated", reason: null, commit: "c",
				lane: { path: f.lanePath, branch: f.laneBranch, base_head: "b", lane_commit: "c" },
				session: { key: f.key, generation: 1, baseline: "r", handle: "h", entry_submitted: true, attention: null, no_progress: 0, exit_proof: null },
				qa_failures: 0,
			};
			const update = await cleanupOneIntegratedChild({ root: f.repo, branch: f.parentRef, child, sessions: refusalPort(code, reason) });
			expect(update?.lane_retained?.condition).toContain(code);
			expect(existsSync(f.lanePath)).toBe(true);
		});
	}

	it("mismatched session_key keeps the Lane as not_owned", async () => {
		const f = fixture("t", "t");
		const sessions = provenPort("h", f.key);
		const child: Parameters<typeof cleanupOneIntegratedChild>[0]["child"] = {
			task_id: "t", slice_id: "S1", blocked_by: [], state: "integrated", reason: null, commit: "c",
			lane: { path: f.lanePath, branch: f.laneBranch, base_head: "b", lane_commit: "c" },
			session: { key: "imm-other-g1-abc999aaabbb", generation: 1, baseline: "r", handle: "h", entry_submitted: true, attention: null, no_progress: 0, exit_proof: null },
			qa_failures: 0,
		};
		const update = await cleanupOneIntegratedChild({ root: f.repo, branch: f.parentRef, child, sessions });
		expect(update?.lane_retained?.condition).toContain("not_owned");
		expect(existsSync(f.lanePath)).toBe(true);
	});

	it("superseded handle keeps the Lane as not_owned", async () => {
		const f = fixture("t", "t");
		const sessions = provenPort("h-current", f.key);
		const child: Parameters<typeof cleanupOneIntegratedChild>[0]["child"] = {
			task_id: "t", slice_id: "S1", blocked_by: [], state: "integrated", reason: null, commit: "c",
			lane: { path: f.lanePath, branch: f.laneBranch, base_head: "b", lane_commit: "c" },
			session: { key: f.key, generation: 1, baseline: "r", handle: "h-old", entry_submitted: true, attention: null, no_progress: 0, exit_proof: null },
			qa_failures: 0,
		};
		const update = await cleanupOneIntegratedChild({ root: f.repo, branch: f.parentRef, child, sessions });
		expect(update?.lane_retained?.condition).toContain("not_owned");
		expect(existsSync(f.lanePath)).toBe(true);
	});

	for (const [name, content] of [["tracked.txt", "edited\n"], ["stray.txt", "stray\n"]] as const) {
		it(`untracked or modified file (${name}) keeps the Lane naming the file`, async () => {
			const f = fixture("t", "t");
			const { writeFileSync } = await import("node:fs");
			writeFileSync(join(f.lanePath, name), content);
			const outcome = cleanupIntegratedChildLane({ root: f.repo, lanePath: f.lanePath, laneBranch: f.laneBranch, parentRef: f.parentRef,
				proof: { ok: true, exited: true, handle: "h", key: f.key } });
			expect(outcome).toEqual({ status: "retained", condition: expect.stringContaining(`the Lane has tracked modifications or untracked files: ${name}`) });
			expect(existsSync(f.lanePath)).toBe(true);
		});
	}

	it("parked and stopped children are never removed and report batch_lane_retained", async () => {
		const f = fixture("t", "t");
		const sessions = provenPort("h", f.key);
		// Parked: needs_human waiting on a decision. Stopped: needs_human after a
		// native-gated stop. Redo: lane_committed awaiting Lane recreation.
		// None are passed to closeWithProof; parked/stopped report via notices.
		const parked: Parameters<typeof cleanupOneIntegratedChild>[0]["child"] = {
			task_id: "t", slice_id: "S1", blocked_by: [], state: "needs_human", reason: "lane_executor_no_progress",
			commit: "c", lane: { path: f.lanePath, branch: f.laneBranch, base_head: "b", lane_commit: "c" },
			session: { key: f.key, generation: 1, baseline: "r", handle: "h", entry_submitted: true, attention: null, no_progress: 0, exit_proof: null },
			qa_failures: 0,
		};
		const stopped: Parameters<typeof cleanupOneIntegratedChild>[0]["child"] = {
			task_id: "t", slice_id: "S1", blocked_by: [], state: "needs_human", reason: "lane_executor_stopped",
			commit: "c", lane: { path: f.lanePath, branch: f.laneBranch, base_head: "b", lane_commit: "c" },
			session: { key: f.key, generation: 1, baseline: "r", handle: "h", entry_submitted: true, attention: null, no_progress: 0, exit_proof: null },
			qa_failures: 0,
		};
		const redo: Parameters<typeof cleanupOneIntegratedChild>[0]["child"] = {
			task_id: "t", slice_id: "S1", blocked_by: [], state: "lane_committed", reason: null,
			commit: null, lane: { path: f.lanePath, branch: f.laneBranch, base_head: "b", lane_commit: "c" },
			session: { key: f.key, generation: 1, baseline: "r", handle: "h", entry_submitted: true, attention: null, no_progress: 0, exit_proof: null },
			qa_failures: 0, redo_head: "r",
		};
		for (const child of [parked, stopped, redo]) {
			expect(await cleanupOneIntegratedChild({ root: f.repo, branch: f.parentRef, child, sessions })).toBeNull();
			expect(existsSync(f.lanePath)).toBe(true);
			expect(branches(f.repo)).toContain(f.laneBranch);
		}
		// Parked and stopped report batch_lane_retained naming the condition;
		// redo reports batch_lane_redo_retained and is never passed to cleanup.
		for (const [child, text] of [[parked, "lane_executor_no_progress"], [stopped, "lane_executor_stopped"]] as const) {
			const notices = retainedLaneNotices(f.repo, {
				contract: "assurance_kernel/batch_run_state/v3", batch_id: "b", initiative_slug: "t", plan_digest: "d",
				base_head: "h", branch: f.parentRef, confirmation_time: "2026-01-01T00:00:00.000Z",
				budget: { max_children: 1, qa_failure_limit: 3 }, max_parallel: 1, batch_state: "needs_human",
				children: [{ ...child, lane: { ...child.lane!, run_id: null } }], commits: [],
				created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z",
			} as never);
			expect(notices).toEqual([{ task_id: "t", path: f.lanePath,
				reason: expect.stringContaining("batch_lane_retained:") }]);
			expect(notices[0]!.reason).toContain(text);
		}
	});
});

describe("persisted lane_removed carries a SessionExitProof (validation)", () => {
	it("writes and re-reads lane_removed with a SessionExitProof for single-task and Initiative children", () => {
		for (const [slug, task] of [["e2e-task", "e2e-task"], ["slug", "child-1"]] as const) {
			const dir = realpathSync(mkdtempSync(join(tmpdir(), "imm-slc-persist-")));
			roots.push(dir);
			const repo = join(dir, "repo");
			mkdirSync(repo);
			writeFileSync(join(repo, ".gitignore"), ".imm/state/\n");
			writeFileSync(join(repo, "base.txt"), "base\n");
			git(repo, "init", "-q", "-b", "main");
			git(repo, "add", "-A"); git(repo, "commit", "-qm", "base");
			const base = git(repo, "rev-parse", "HEAD");
			const kids = [{ task_id: task, slice_id: "S1", blocked_by: [] as string[], status: "enrollable" as const, reason: null,
				intent_path: "docs/plans/x.intent.json", intent_revision: 1, intent_content_hash: "0".repeat(64) }];
			const record = prepareBatchLaneRunState({ batch_id: `b-${task}`, initiative_slug: slug, children: kids as never,
				plan_digest: "d".repeat(64), base_head: base, confirmation_time: "2026-01-01T00:00:00.000Z",
				budget: { max_children: 1, qa_failure_limit: 3 }, max_parallel: 1, now: "2026-01-02T00:00:00.000Z" });
			record.branch = `refs/heads/imm/${slug}`;
			record.commits = [base];
			record.children = [{ task_id: task, slice_id: "S1", blocked_by: [], state: "integrated", reason: null, commit: base,
				lane: { path: join(dir, "lane"), branch: `imm-lane/${slug}/${task}`, base_head: base, lane_commit: base },
				session: null, qa_failures: 0,
				lane_removed: { exit: { ok: true, exited: true, handle: "h1", key: `imm-${task}-g1-abc123def456` }, worktree: join(dir, "lane"), branches: [`imm-lane/${slug}/${task}`] } } as never];
			writeBatchLaneRunState(repo, record);
			const reread = readAnyBatchRunState(repo, `b-${task}`)!;
			expect(reread.contract).toBe("assurance_kernel/batch_run_state/v3");
			if (!("children" in reread)) throw new Error("expected Lane record");
			const child = (reread as { children: Array<{ lane_removed?: { exit: unknown } }> }).children[0]!;
			expect(child.lane_removed).toMatchObject({ exit: { ok: true, exited: true, handle: "h1" }, branches: [`imm-lane/${slug}/${task}`] });
		}
	});
});

describe("end-to-end single-task checkout_delivery drives runLaneBatch to persisted lane_removed", () => {
	it("integrates, stages to the checkout, proves exit and removes worktree, imm-lane and imm branches", async () => {
		const task = "e2e-task";
		const dir = realpathSync(mkdtempSync(join(tmpdir(), "imm-slc-e2e-")));
		roots.push(dir);
		const repo = join(dir, "repo");
		mkdirSync(join(repo, "docs/plans"), { recursive: true });
		mkdirSync(join(repo, ".imm"), { recursive: true });
		writeFileSync(join(repo, ".gitignore"), ".imm/state/\n");
		writeFileSync(join(repo, ".imm/config.json"), JSON.stringify({ contract: "immune_brain/project_config/v2", git_integration: "manual" }));
		writeFileSync(join(repo, "base.txt"), "base\n");
		const verification = JSON.stringify({ contract: "assurance_kernel/verification_descriptor/v2",
			command: { executable: "bun", argv: ["-e", "process.exit(0)"], cwd: ".", timeout_ms: 60000, max_output_bytes: 4096 },
			environment: { prepare: null, writable_paths: [] } });
		writeFileSync(join(repo, `docs/plans/${task}.intent.json`), `${JSON.stringify({ contract: "assurance_kernel/task_intent/v1",
			task_id: task, owner: "user", goal: "Deliver", acceptance: [{ id: "A1", assertion: "holds", verification }],
			scope_hint: ["delivery.txt"], risk: "material", revision: 1 })}\n`);
		git(repo, "init", "-q", "-b", "main");
		git(repo, "add", "-A"); git(repo, "commit", "-qm", "base");
		const base = git(repo, "rev-parse", "HEAD");
		const { readTaskIntent } = await import("../plugins/immune-brain/runtime/kernel/intent");
		const { canonicalIntentHash } = await import("../plugins/immune-brain/runtime/kernel/intent");
		const { computeBatchPlanDigest, createBatchAuthorityRegistry } = await import("../plugins/immune-brain/runtime/kernel/batch_authority");
		const { createEnrollmentAuthorityRegistry } = await import("../plugins/immune-brain/runtime/kernel/enrollment_authority");
		const { createBatchKernelPort } = await import("../plugins/immune-brain/runtime/unattended/batch_kernel_port");
		const { createDefaultBatchGitPort } = await import("../plugins/immune-brain/runtime/unattended/batch_git");
		const { createDefaultLaneGitPort, runLaneBatch } = await import("../plugins/immune-brain/runtime/unattended/batch_lanes");
		const intent = readTaskIntent(repo, task);
		const children = [{ task_id: task, slice_id: task, blocked_by: [] as string[], status: "enrollable" as const, reason: null,
			intent_path: intent.intent_ref.path, intent_revision: intent.intent_ref.revision,
			intent_content_hash: canonicalIntentHash(intent.intent) }];
		const registry = createBatchAuthorityRegistry();
		const planDigest = computeBatchPlanDigest(children as never);
		const budget = { max_children: 1, qa_failure_limit: 2 };
		const branch = `refs/heads/imm/${task}`;
		const binding = { batch_id: "e2e-one", initiative_slug: task, plan_digest: planDigest, branch,
			base_head: base, budget, actor_id: "user", confirmation_ref: "confirm", nonce: "n" };
		const capability = registry.issue(binding, children as never, "2026-01-01T00:00:00.000Z");
		// Build the integrated Lane by hand at the runtime-owned path, as
		// createLaneWorktree would: <common>/imm/worktrees/<slug>/<task>.
		// Lane branch tip holds delivery, Parent branch already contains it
		// (as integration would).
		const laneBranch = `imm-lane/${task}/${task}`;
		const lanePath = join(repo, ".git", "imm", "worktrees", task, task);
		mkdirSync(join(repo, ".git", "imm", "worktrees", task), { recursive: true });
		git(repo, "worktree", "add", "-q", "-b", laneBranch, lanePath, base);
		writeFileSync(join(lanePath, "delivery.txt"), "delivered\n");
		const laneIntent = readTaskIntent(lanePath, task);
		const { seedKernelRunForTest: seedE2E } = await import("./fixtures/mutation-authority-test-seam");
		const { recoverKernelStoreFollowUps: recoverE2E } = await import("../plugins/immune-brain/runtime/kernel/storage");
		seedE2E(lanePath, { task_id: task, run_id: "run-e2e", terminal: { lifecycle: "done" }, record: {
			contract: "assurance_kernel/task_record/v4", task_id: task, intent_snapshot: laneIntent.intent,
			intent_ref: { path: laneIntent.intent_ref.path, content_hash: laneIntent.content_hash }, lifecycle: "done", artifact_state: "frozen",
			baseline: laneIntent.content_hash, git_base_head: git(lanePath, "rev-parse", "HEAD"), attestations: [], findings: [], history: [] } });
		recoverE2E(lanePath, task);
		git(lanePath, "add", "-A"); git(lanePath, "commit", "-qm", "delivery");
		const laneTip = git(lanePath, "rev-parse", "HEAD");
		git(repo, "update-ref", branch, laneTip);
		const key = `imm-${task}-g1-abc123def456`;
		const handle = "h-e2e";
		// Generic proven port for the stored (handle, key).
		const sessions: BatchSessionPort = {
			provider: "fake",
			async open(input) { return { ok: true, handle, entry_submitted: true }; },
			async resume() { return { ok: true, entry_submitted: true }; },
			async find(k) { return k === key ? { ok: true, handle } : { ok: true, not_found: true as const }; },
			async observe() { return { ok: true, state: "idle" as const }; },
			async send() { return { ok: true, state: "idle" as const }; },
			async stop() { return { ok: true }; },
			async closeWithProof(h, k) {
				if (h !== handle || k !== key) return { ok: false, code: "not_owned", reason: "handle was not created for this session key" };
				return { ok: true, exited: true as const, handle, key };
			},
		};
		// Persist an integrated record carrying the session, as the
		// reconciler would have stored it before integration.
		const record = prepareBatchLaneRunState({ plan_source: "single_task", batch_id: "e2e-one", initiative_slug: task,
			children: children as never, plan_digest: planDigest, base_head: base, confirmation_time: "2026-01-01T00:00:00.000Z",
			budget, max_parallel: 1, now: "2026-01-02T00:00:00.000Z" });
		record.branch = branch;
		record.children = [{ task_id: task, slice_id: task, blocked_by: [], state: "integrated", reason: null, commit: laneTip,
			lane: { path: lanePath, branch: laneBranch, base_head: base, lane_commit: laneTip }, qa_failures: 0,
			session: { key, generation: 1, baseline: "r", handle, entry_submitted: true, attention: null, no_progress: 0, exit_proof: null } } as never];
		record.commits = [laneTip];
		writeBatchLaneRunState(repo, record);
		const kernel = createBatchKernelPort({ root: repo, enrollmentRegistry: createEnrollmentAuthorityRegistry(),
			registry, capability, binding, advanceTask: async () => ({ state: "completed" as const }),
			resume: { isResuming: false, existingBatch: null, batchBranch: branch },
			overrides: {} as never });
		const gitPort = Object.assign(createDefaultBatchGitPort(), { lane: createDefaultLaneGitPort() });
		const report = await runLaneBatch({ root: repo, plan_source: "single_task", batch_id: "e2e-one", initiative_slug: task,
			registry, capability, children: children as never, plan_digest: planDigest, base_head: base,
			confirmation_time: "2026-01-02T00:00:00.000Z", budget, now: "2026-01-03T00:00:00.000Z",
			kernel: kernel as never, git: gitPort, max_parallel: 1, sessions } as never, record as never) as unknown as {
			batch_state: string; children: Array<{ state: string; lane_removed?: { exit: unknown; worktree: string; branches: string[] }; lane_retained?: { condition: string } }> };
		expect(report.batch_state).toBe("completed");
		const removed = report.children[0]!.lane_removed!;
		expect(removed.exit).toMatchObject({ ok: true, exited: true, handle, key });
			expect(removed.worktree).toBe(lanePath);
			expect([...removed.branches].sort()).toEqual([laneBranch, `imm/${task}`]);
		expect(existsSync(lanePath)).toBe(false);
		// Manual-mode delivery staged the delta and both branches are gone.
		expect(git(repo, "diff", "--cached", "--name-only").split("\n")).toContain("delivery.txt");
		expect(git(repo, "for-each-ref", "--format=%(refname:short)", "refs/heads/imm-lane", "refs/heads/imm").split("\n").filter(Boolean)).toEqual([]);
		const persisted = readAnyBatchRunState(repo, "e2e-one")! as unknown as { children: Array<{ lane_removed?: { exit: unknown } }> };
		expect(persisted.children[0]!.lane_removed).toMatchObject({ exit: { ok: true, exited: true, handle } });
	}, 120_000);
});

