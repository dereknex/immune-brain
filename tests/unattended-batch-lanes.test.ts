import { describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AssuranceProjectionResult } from "../plugins/immune-brain/runtime/kernel/assurance_projection";
import { computeBatchPlanDigest, createBatchAuthorityRegistry } from "../plugins/immune-brain/runtime/kernel/batch_authority";
import { createEnrollmentAuthorityRegistry } from "../plugins/immune-brain/runtime/kernel/enrollment_authority";
import { canonicalIntentHash, parseTaskIntentV1 } from "../plugins/immune-brain/runtime/kernel/intent";
import { preparePiCanary } from "../plugins/immune-brain/runtime/kernel/pi_canary_prepare";
import { createBatchKernelPort } from "../plugins/immune-brain/runtime/unattended/batch_kernel_port";
import { readActiveClaimTaskId } from "../plugins/immune-brain/runtime/unattended/batch_preflight";
import { seedKernelRunForTest } from "./fixtures/mutation-authority-test-seam";
import type { BatchRunnerGitPort } from "../plugins/immune-brain/runtime/unattended/batch_git";
import {
	BatchIntegrationError,
	changeIdentity,
	identitiesEqual,
	integrateLaneCommit,
} from "../plugins/immune-brain/runtime/unattended/batch_integration";
import {
	createDefaultLaneGitPort,
	decideLaneAdmission,
	laneBranchName,
	parseLaneOffers,
	parseMaxParallel,
	runLaneBatch,
	type LaneFacts,
	type LaneOffer,
} from "../plugins/immune-brain/runtime/unattended/batch_lanes";
import type { BatchRunnerKernelPort, StartBatchInput } from "../plugins/immune-brain/runtime/unattended/batch_runner";
import { startBatch } from "../plugins/immune-brain/runtime/unattended/batch_runner";
import { readAnyBatchRunState, type BatchLaneRunReport } from "../plugins/immune-brain/runtime/unattended/batch_state";
import type { BatchPlanChild } from "../plugins/immune-brain/runtime/unattended/types";

const SLUG = "initiative-slug";
const BATCH_ID = "batch-001";
const BATCH_BRANCH = `imm/${SLUG}`;
const FAR_FUTURE = "2099-01-01T00:00:00.000Z";
const CONFIRMED_AT = "2026-01-01T00:00:00.000Z";

function git(cwd: string, ...args: string[]): string {
	return execFileSync("git", ["-C", cwd, "-c", "user.name=T", "-c", "user.email=t@t", ...args], {
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	}).trim();
}

function child(taskId: string, sliceId: string, blockedBy: string[] = []): BatchPlanChild {
	return {
		task_id: taskId,
		slice_id: sliceId,
		blocked_by: blockedBy,
		status: "enrollable",
		reason: null,
		intent_path: `docs/plans/${taskId}.intent.json`,
		intent_revision: 1,
		intent_content_hash: "0".repeat(64),
	};
}

/** A valid intent sidecar whose single descriptor runs `script` with bun in the delivery tree. */
function intentJson(taskId: string, script = "process.exit(0)", scope: string[] = ["a.txt", "b.txt"]): string {
	const verification = JSON.stringify({
		contract: "assurance_kernel/verification_descriptor/v2",
		command: { executable: "bun", argv: ["-e", script], cwd: ".", timeout_ms: 60000, max_output_bytes: 4096 },
		environment: { prepare: null, writable_paths: [] },
	});
	return `${JSON.stringify({
		contract: "assurance_kernel/task_intent/v1",
		task_id: taskId,
		goal: `Deliver ${taskId}`,
		acceptance: [{ id: "A1", assertion: `${taskId} holds`, verification }],
		scope_hint: scope,
		risk: "material",
		revision: 1,
		owner: "user",
	})}\n`;
}

interface Fixture {
	dir: string;
	repo: string;
	base: string;
	cleanup(): void;
	lane(taskId: string): string;
}

/** A real repository on the batch branch with a base commit; lanes are real worktrees. */
function fixture(scripts: Record<string, string> = {}, scopes: Record<string, string[]> = {}): Fixture {
	const dir = realpathSync(mkdtempSync(join(tmpdir(), "imm-lanes-")));
	const repo = join(dir, "repo");
	mkdirSync(repo);
	git(repo, "init", "-q", "-b", "main");
	writeFileSync(join(repo, ".gitignore"), ".imm/\n");
	writeFileSync(join(repo, "base.txt"), "base\n");
	mkdirSync(join(repo, "docs/plans"), { recursive: true });
	for (const taskId of ["task-a", "task-b", "task-c"])
		writeFileSync(join(repo, `docs/plans/${taskId}.intent.json`), intentJson(taskId, scripts[taskId], scopes[taskId]));
	git(repo, "add", "-A");
	git(repo, "commit", "-q", "-m", "base");
	git(repo, "checkout", "-q", "-b", BATCH_BRANCH);
	return {
		dir,
		repo,
		base: git(repo, "rev-parse", "HEAD"),
		cleanup: () => rmSync(dir, { recursive: true, force: true }),
		lane(taskId) {
			const path = join(dir, `lane-${taskId}`);
			git(repo, "worktree", "add", "-q", "-b", laneBranchName(SLUG, taskId), path, git(repo, "rev-parse", "HEAD"));
			return realpathSync(path);
		},
	};
}

function projectionBody(overrides: Partial<AssuranceProjectionResult["projection"]> = {}): AssuranceProjectionResult["projection"] {
	return {
		run_id: "run-1",
		record_revision: "r1",
		workspace_revision: "w",
		intent_revision: 1,
		intent_content_hash: "sha256:intent",
		diff_hash: "sha256:diff",
		lifecycle: "active",
		artifact_state: "active",
		risk: "material",
		next_obligation: "submit_assurance",
		fresh_acceptance_ids: [],
		missing_acceptance_ids: [],
		stale_attestation_ids: [],
		fresh_approval_kinds: [],
		missing_approval_kinds: [],
		blocking_finding_ids: [],
		unresolved_user_decision_ids: [],
		replan_required_ids: [],
		independence_violations: [],
		open_user_decision_count: 0,
		completion_ready: false,
		authorization: { state: "none", blocked: null },
		...overrides,
	} as AssuranceProjectionResult["projection"];
}

type LaneKernel = BatchRunnerKernelPort & {
	enrolled: Map<string, string>;
	frozen: Set<string>;
	settled: Set<string>;
	advanced: string[];
	reworking: Set<string>;
};

function laneKernel(): LaneKernel {
	const kernel = {
		enrolled: new Map<string, string>(),
		frozen: new Set<string>(),
		settled: new Set<string>(),
		advanced: [] as string[],
		reworking: new Set<string>(),
		async enrollTask({ root, task_id }: { root: string; task_id: string }) {
			kernel.enrolled.set(task_id, root);
			return { record_revision: "r" };
		},
		async advanceTask(_root: string, taskId: string) {
			kernel.advanced.push(taskId);
			if (kernel.reworking.has(taskId)) return { state: "rework" as const, operation: "qa" as const };
			kernel.settled.add(taskId);
			return { state: "completed" as const };
		},
		async projectTask(_root: string, taskId: string): Promise<AssuranceProjectionResult> {
			const claimed = kernel.enrolled.has(taskId) && !kernel.settled.has(taskId);
			const done = kernel.settled.has(taskId);
			return {
				contract: "assurance_kernel/assurance_projection/v1",
				task_id: taskId,
				error: null,
				claim: claimed ? { task_id: taskId, lifecycle_status: "active" } : null,
				projection: projectionBody({
					lifecycle: done ? "done" : "active",
					completion_ready: done,
					artifact_state: kernel.frozen.has(taskId) ? "frozen" : "active",
				}),
			} as AssuranceProjectionResult;
		},
		ownsTaskClaim: (taskId: string) => kernel.enrolled.has(taskId),
		validateBatchAuthorization: ({ registry, capability, binding }: Parameters<BatchRunnerKernelPort["validateBatchAuthorization"]>[0]) =>
			registry.inspect(capability, { ...binding, branch: "main", actor_id: "user", confirmation_ref: "confirm", nonce: "n" } as never),
	};
	return kernel as unknown as LaneKernel;
}

/** A serial git port whose commitChild commits the lane worktree for real. */
function laneGit(): BatchRunnerGitPort {
	return {
		preflight: () => ({ ok: true, branch: BATCH_BRANCH }),
		async lookupBatchCommit(root, taskId, batchId, expectedHead) {
			const log = git(root, "log", "--format=%H%x00%s", `${expectedHead}..HEAD`).split("\n").filter(Boolean);
			const hit = log.map((line) => line.split("\0")).find(([, subject]) => subject?.startsWith(`imm(${taskId}):`));
			void batchId;
			return hit ? { commit: hit[0]! } : null;
		},
		async commitChild(root, taskId, batchId) {
			git(root, "add", "-A");
			git(root, "commit", "-q", "-m", `imm(${taskId}): deliver`, "-m", `Immune-Brain-Batch: ${batchId}`);
			return { commit: git(root, "rev-parse", "HEAD") };
		},
	};
}

function request(
	fx: Fixture,
	children: BatchPlanChild[],
	kernel: BatchRunnerKernelPort,
	overrides: Partial<StartBatchInput> = {},
): StartBatchInput {
	const registry = createBatchAuthorityRegistry();
	const planDigest = computeBatchPlanDigest(children);
	const budget = overrides.budget ?? { max_children: children.length, qa_failure_limit: 3 };
	const capability = registry.issue(
		{
			batch_id: BATCH_ID,
			initiative_slug: SLUG,
			plan_digest: planDigest,
			branch: "main",
			base_head: fx.base,
			budget,
			actor_id: "user",
			confirmation_ref: "confirm",
			nonce: "n",
		},
		children,
		CONFIRMED_AT,
	);
	return {
		root: fx.repo,
		batch_id: BATCH_ID,
		initiative_slug: SLUG,
		registry,
		capability,
		children,
		plan_digest: planDigest,
		base_head: fx.base,
		confirmation_time: CONFIRMED_AT,
		budget,
		now: FAR_FUTURE,
		kernel,
		git: laneGit(),
		max_parallel: 1,
		...overrides,
	};
}

const lanes = (report: unknown) => report as BatchLaneRunReport;

describe("lane mode parameters", () => {
	it("accepts positive integers and rejects everything else", () => {
		expect(parseMaxParallel(undefined)).toBeUndefined();
		expect(parseMaxParallel(1)).toBe(1);
		for (const bad of [0, -1, 1.5, "1", Number.NaN, Infinity, null === undefined ? 0 : {}]) {
			expect(() => parseMaxParallel(bad)).toThrow(/max_parallel/);
		}
	});

	it("shape-checks offers as untrusted input", () => {
		expect(parseLaneOffers(undefined)).toBeUndefined();
		expect(parseLaneOffers([{ task_id: "task-a", path: "/tmp/x" }])).toEqual([{ task_id: "task-a", path: "/tmp/x" }]);
		expect(() => parseLaneOffers("x")).toThrow();
		expect(() => parseLaneOffers([{ task_id: "task-a", path: "relative/path" }])).toThrow(/absolute/);
		expect(() => parseLaneOffers([{ task_id: "../escape", path: "/tmp/x" }])).toThrow(/task id/);
		expect(() => parseLaneOffers([{ task_id: "task-a", path: "/tmp/x", extra: 1 }])).toThrow(/unknown/);
		expect(() => parseLaneOffers([{ task_id: "task-a", path: "/tmp/\0x" }])).toThrow();
		expect(() =>
			parseLaneOffers([
				{ task_id: "task-a", path: "/tmp/x" },
				{ task_id: "task-a", path: "/tmp/y" },
			]),
		).toThrow(/duplicate/);
	});
});

describe("lane admission", () => {
	const clean = (overrides: Partial<LaneFacts> = {}): LaneFacts => ({
		exists: true,
		real_path: "/lane",
		same_repository: true,
		is_worktree_root: true,
		branch: "imm-lane/s/t",
		head: "h",
		clean: true,
		active_claim_task_id: null,
		...overrides,
	});
	const decide = (facts: LaneFacts, bound: string[] = []) =>
		decideLaneAdmission({
			facts,
			coordinator_real_path: "/coordinator",
			expected_branch: "imm-lane/s/t",
			batch_head: "h",
			bound_paths: bound,
		});

	it("admits a clean, unoccupied lane on the expected branch at the batch head", () => {
		expect(decide(clean())).toBeNull();
	});

	it("names one stable reason per refusal", () => {
		expect(decide(clean({ exists: false, real_path: null }))).toBe("batch_lane_foreign_repository");
		expect(decide(clean({ same_repository: false }))).toBe("batch_lane_foreign_repository");
		expect(decide(clean({ is_worktree_root: false }))).toBe("batch_lane_foreign_repository");
		expect(decide(clean({ real_path: "/coordinator" }))).toBe("batch_lane_is_coordinator");
		expect(decide(clean({ branch: "other" }))).toBe("batch_lane_branch_mismatch");
		expect(decide(clean({ head: "moved" }))).toBe("batch_lane_base_mismatch");
		expect(decide(clean({ clean: false }))).toBe("batch_lane_dirty");
		expect(decide(clean({ active_claim_task_id: "task-z" }))).toBe("batch_lane_occupied");
		expect(decide(clean(), ["/lane"])).toBe("batch_lane_occupied");
	});

	it("reads real facts from real worktrees", () => {
		const fx = fixture();
		try {
			const port = createDefaultLaneGitPort();
			const lane = fx.lane("task-a");
			const facts = port.inspectLane(fx.repo, lane);
			expect(facts).toMatchObject({
				exists: true,
				same_repository: true,
				is_worktree_root: true,
				branch: laneBranchName(SLUG, "task-a"),
				head: fx.base,
				clean: true,
				active_claim_task_id: null,
			});
			expect(port.inspectLane(fx.repo, fx.repo).real_path).toBe(port.resolveRoot(fx.repo));

			writeFileSync(join(lane, "stray.txt"), "x");
			expect(port.inspectLane(fx.repo, lane).clean).toBe(false);

			const foreign = join(fx.dir, "foreign");
			mkdirSync(foreign);
			git(foreign, "init", "-q");
			expect(port.inspectLane(fx.repo, foreign).same_repository).toBe(false);
			expect(port.inspectLane(fx.repo, join(fx.dir, "missing")).exists).toBe(false);

			mkdirSync(join(lane, "sub"));
			expect(port.inspectLane(fx.repo, join(lane, "sub")).is_worktree_root).toBe(false);
		} finally {
			fx.cleanup();
		}
	});
});

describe("lane integration", () => {
	function laneCommitOf(fx: Fixture, taskId: string, file: string, body: string): { lane: string; commit: string } {
		const lane = fx.lane(taskId);
		writeFileSync(join(lane, file), body);
		git(lane, "add", "-A");
		git(lane, "commit", "-q", "-m", `imm(${taskId}): deliver`);
		return { lane, commit: git(lane, "rev-parse", "HEAD") };
	}

	it("fast-forwards to the lane commit itself when the batch head is the lane base", () => {
		const fx = fixture();
		try {
			const { commit } = laneCommitOf(fx, "task-a", "a.txt", "a\n");
			const landed = integrateLaneCommit({ root: fx.repo, branch: BATCH_BRANCH, batch_head: fx.base, lane_base: fx.base, lane_commit: commit });
			expect(landed.commit).toBe(commit);
			expect(git(fx.repo, "rev-parse", "HEAD")).toBe(commit);
			expect(readFileSync(join(fx.repo, "a.txt"), "utf8")).toBe("a\n");
		} finally {
			fx.cleanup();
		}
	});

	it("replays a lane change onto a moved batch head and keeps its identity", () => {
		const fx = fixture();
		try {
			const { commit } = laneCommitOf(fx, "task-b", "b.txt", "b\n");
			writeFileSync(join(fx.repo, "other.txt"), "o\n");
			git(fx.repo, "add", "-A");
			git(fx.repo, "commit", "-q", "-m", "other work");
			const head = git(fx.repo, "rev-parse", "HEAD");
			const landed = integrateLaneCommit({ root: fx.repo, branch: BATCH_BRANCH, batch_head: head, lane_base: fx.base, lane_commit: commit });
			expect(landed.commit).not.toBe(commit);
			expect(git(fx.repo, "rev-parse", "HEAD")).toBe(landed.commit);
			expect(git(fx.repo, "rev-parse", "HEAD^")).toBe(head);
			expect(identitiesEqual(changeIdentity(fx.repo, fx.base, commit), changeIdentity(fx.repo, head, landed.commit))).toBe(true);
			expect(readFileSync(join(fx.repo, "b.txt"), "utf8")).toBe("b\n");
		} finally {
			fx.cleanup();
		}
	});

	it("refuses a conflicting change and leaves the batch branch unmoved", () => {
		const fx = fixture();
		try {
			const lane = fx.lane("task-c");
			writeFileSync(join(lane, "base.txt"), "lane edit\n");
			git(lane, "commit", "-q", "-am", "imm(task-c): deliver");
			const commit = git(lane, "rev-parse", "HEAD");
			writeFileSync(join(fx.repo, "base.txt"), "batch edit\n");
			git(fx.repo, "commit", "-q", "-am", "conflicting");
			const head = git(fx.repo, "rev-parse", "HEAD");
			let error: unknown;
			try {
				integrateLaneCommit({ root: fx.repo, branch: BATCH_BRANCH, batch_head: head, lane_base: fx.base, lane_commit: commit });
			} catch (caught) {
				error = caught;
			}
			expect(error).toBeInstanceOf(BatchIntegrationError);
			expect((error as BatchIntegrationError).reason).toBe("batch_integration_conflict");
			expect(git(fx.repo, "rev-parse", "HEAD")).toBe(head);
		} finally {
			fx.cleanup();
		}
	});

	it("refuses a broken lineage: wrong branch, moved head, foreign parent", () => {
		const fx = fixture();
		try {
			const { commit } = laneCommitOf(fx, "task-d", "d.txt", "d\n");
			const reasonOf = (input: Parameters<typeof integrateLaneCommit>[0]) => {
				try {
					integrateLaneCommit(input);
				} catch (caught) {
					return (caught as BatchIntegrationError).reason;
				}
				return null;
			};
			const base = { root: fx.repo, branch: BATCH_BRANCH, batch_head: fx.base, lane_base: fx.base, lane_commit: commit };
			expect(reasonOf({ ...base, branch: "imm/other" })).toBe("batch_head_lineage_broken");
			expect(reasonOf({ ...base, batch_head: commit })).toBe("batch_head_lineage_broken");
			expect(reasonOf({ ...base, lane_base: commit })).toBe("batch_head_lineage_broken");
			expect(git(fx.repo, "rev-parse", "HEAD")).toBe(fx.base);
		} finally {
			fx.cleanup();
		}
	});

	it("refuses a candidate whose change differs from the lane commit and leaves the batch branch unmoved", () => {
		const fx = fixture();
		try {
			const { commit } = laneCommitOf(fx, "task-g", "g.txt", "same\n");
			// The batch branch already carries the lane's exact edit, so replaying the
			// lane commit yields an empty change: the candidate no longer carries it.
			writeFileSync(join(fx.repo, "g.txt"), "same\n");
			git(fx.repo, "add", "-A");
			git(fx.repo, "commit", "-q", "-m", "identical edit");
			const head = git(fx.repo, "rev-parse", "HEAD");
			let error: unknown;
			try {
				integrateLaneCommit({ root: fx.repo, branch: BATCH_BRANCH, batch_head: head, lane_base: fx.base, lane_commit: commit });
			} catch (caught) {
				error = caught;
			}
			expect(error).toBeInstanceOf(BatchIntegrationError);
			expect((error as BatchIntegrationError).reason).toBe("batch_integration_conflict");
			expect((error as BatchIntegrationError).message).toContain("does not carry the lane commit");
			expect(git(fx.repo, "rev-parse", "HEAD")).toBe(head);
			expect(git(fx.repo, "rev-parse", BATCH_BRANCH)).toBe(head);
		} finally {
			fx.cleanup();
		}
	});

	it("distinguishes changes that differ in content or mode", () => {
		const fx = fixture();
		try {
			const a = laneCommitOf(fx, "task-e", "e.txt", "one\n");
			const b = laneCommitOf(fx, "task-f", "e.txt", "two\n");
			expect(identitiesEqual(changeIdentity(fx.repo, fx.base, a.commit), changeIdentity(fx.repo, fx.base, b.commit))).toBe(false);
		} finally {
			fx.cleanup();
		}
	});
});

describe("max_parallel 1 end to end through a real second worktree", () => {
	it("provisions, enrolls, commits on the lane, integrates and completes two dependent children", async () => {
		const fx = fixture();
		try {
			const kernel = laneKernel();
			const children = [child("task-a", "S1"), child("task-b", "S2", ["task-a"])];
			const args = request(fx, children, kernel);

			// Tick 1: no Lane offered yet, the coordinator asks for one.
			const first = lanes(await startBatch(args));
			expect(first.batch_state).toBe("running");
			expect(first.handoffs).toEqual([
				{
					role: "lane-steward",
					action: "provision",
					task_id: "task-a",
					lane_branch: laneBranchName(SLUG, "task-a"),
					base_head: fx.base,
					executor_hosts: ["claude-code", "pi"],
				},
			]);
			expect(first).not.toHaveProperty("handoff");
			expect(readAnyBatchRunState(fx.repo, BATCH_ID)?.contract).toBe("assurance_kernel/batch_run_state/v2");
			expect(kernel.enrolled.size).toBe(0);

			// Tick 2: the Lane is offered and the child is enrolled in it.
			const laneA = fx.lane("task-a");
			const second = lanes(await startBatch({ ...args, lane_offers: [{ task_id: "task-a", path: laneA }] }));
			expect(second.children.map((c) => c.state)).toEqual(["enrolled", "pending"]);
			expect(kernel.enrolled.get("task-a")).toBe(laneA);
			expect(second.handoffs).toMatchObject([{ role: "executor", task_id: "task-a", lane_branch: laneBranchName(SLUG, "task-a") }]);
			expect(kernel.advanced).toEqual([]);

			// Tick 3: the Executor delivered and froze; the batch advances, commits on the lane and integrates.
			writeFileSync(join(laneA, "a.txt"), "a\n");
			kernel.frozen.add("task-a");
			const third = lanes(await startBatch(args));
			expect(kernel.advanced).toEqual(["task-a"]);
			expect(third.children.map((c) => c.state)).toEqual(["integrated", "pending"]);
			expect(third.commits).toHaveLength(1);
			expect(git(fx.repo, "rev-parse", "HEAD")).toBe(third.commits[0]!);
			expect(git(fx.repo, "rev-parse", `${laneBranchName(SLUG, "task-a")}`)).toBe(third.commits[0]!);
			expect(readFileSync(join(fx.repo, "a.txt"), "utf8")).toBe("a\n");
			expect(third.handoffs).toMatchObject([
				{ role: "lane-steward", action: "provision", task_id: "task-b", base_head: third.commits[0] },
			]);

			// Tick 4: the second child runs in a Lane cut from the new batch head.
			const laneB = fx.lane("task-b");
			await startBatch({ ...args, lane_offers: [{ task_id: "task-b", path: laneB }] });
			writeFileSync(join(laneB, "b.txt"), "b\n");
			kernel.frozen.add("task-b");
			const done = lanes(await startBatch(args));
			expect(done.batch_state).toBe("completed");
			expect(done.children.map((c) => c.state)).toEqual(["integrated", "integrated"]);
			expect(done.commits).toHaveLength(2);
			expect(git(fx.repo, "log", "--format=%s", `${fx.base}..HEAD`).split("\n")).toEqual(["imm(task-b): deliver", "imm(task-a): deliver"]);
			expect(existsSync(join(fx.repo, ".imm/state/batches/batch-001.report.json"))).toBe(true);
			// The runner adopted the two worktrees the test made and created or removed none.
			const worktrees = git(fx.repo, "worktree", "list", "--porcelain")
				.split("\n")
				.filter((line) => line.startsWith("worktree "))
				.map((line) => line.slice("worktree ".length))
				.sort();
			expect(worktrees).toEqual([fx.repo, laneA, laneB].sort());
			expect(git(fx.repo, "symbolic-ref", "--short", "HEAD")).toBe(BATCH_BRANCH);
		} finally {
			fx.cleanup();
		}
	});

	it("refuses offers with a stable reason and writes nothing for them", async () => {
		const fx = fixture();
		try {
			const kernel = laneKernel();
			const args = request(fx, [child("task-a", "S1"), child("task-b", "S2", ["task-a"])], kernel);
			await startBatch(args);
			const wrongBranch = join(fx.dir, "wrong");
			git(fx.repo, "worktree", "add", "-q", "-b", "scratch", wrongBranch, "HEAD");
			const offers: LaneOffer[] = [
				{ task_id: "task-a", path: wrongBranch },
				{ task_id: "task-b", path: fx.lane("task-b") },
				{ task_id: "task-a", path: fx.repo },
			];
			const report = lanes(await startBatch({ ...args, lane_offers: offers.slice(0, 1) }));
			expect(report.lane_refusals).toEqual([{ task_id: "task-a", path: wrongBranch, reason: "batch_lane_branch_mismatch" }]);
			expect(report.children.map((c) => c.state)).toEqual(["pending", "pending"]);
			const blocked = lanes(await startBatch({ ...args, lane_offers: [offers[1]!] }));
			expect(blocked.lane_refusals?.[0]?.reason).toBe("batch_lane_unknown_child");
			const coordinator = lanes(await startBatch({ ...args, lane_offers: [offers[2]!] }));
			expect(coordinator.lane_refusals?.[0]?.reason).toBe("batch_lane_is_coordinator");
			expect(kernel.enrolled.size).toBe(0);
		} finally {
			fx.cleanup();
		}
	});

	it("refuses foreign, moved-base, dirty and occupied Lanes through startBatch with zero writes", async () => {
		const fx = fixture();
		try {
			const kernel = laneKernel();
			const args = request(fx, [child("task-a", "S1")], kernel);
			await startBatch(args);

			const foreign = join(fx.dir, "foreign");
			mkdirSync(foreign);
			git(foreign, "init", "-q", "-b", laneBranchName(SLUG, "task-a"));
			writeFileSync(join(foreign, "f.txt"), "f\n");
			git(foreign, "add", "-A");
			git(foreign, "commit", "-q", "-m", "foreign");

			const moved = fx.lane("task-a");
			writeFileSync(join(moved, "m.txt"), "m\n");
			git(moved, "add", "-A");
			git(moved, "commit", "-q", "-m", "lane moved past the base");

			const stateFile = join(fx.repo, ".imm/state/batches/batch-001.json");
			const observe = (paths: string[]) =>
				JSON.stringify({
					state: JSON.parse(readFileSync(stateFile, "utf8")),
					head: git(fx.repo, "rev-parse", "HEAD"),
					branch: git(fx.repo, "symbolic-ref", "--short", "HEAD"),
					worktrees: git(fx.repo, "worktree", "list", "--porcelain"),
					lanes: paths.map((path) => [git(path, "rev-parse", "HEAD"), git(path, "status", "--porcelain", "--untracked-files=all")]),
					stores: paths.map((path) => existsSync(join(path, ".imm/state/kernel.sqlite"))),
					enrolled: [...kernel.enrolled],
				});
			const refuse = async (path: string, reason: string, watched: string[]) => {
				const before = observe(watched);
				const report = lanes(await startBatch({ ...args, lane_offers: [{ task_id: "task-a", path }] }));
				expect(report.lane_refusals).toEqual([{ task_id: "task-a", path, reason }]);
				expect(report.children.map((c) => c.state)).toEqual(["pending"]);
				expect(observe(watched)).toBe(before);
			};

			await refuse(foreign, "batch_lane_foreign_repository", [foreign]);
			await refuse(moved, "batch_lane_base_mismatch", [moved]);

			git(moved, "reset", "-q", "--hard", fx.base);
			writeFileSync(join(moved, "untracked.txt"), "x\n");
			await refuse(moved, "batch_lane_dirty", [moved]);

			rmSync(join(moved, "untracked.txt"));
			const intent = {
				contract: "assurance_kernel/task_intent/v1", task_id: "task-other", goal: "occupy the lane",
				acceptance: [{ id: "A1", assertion: "a1", verification: "bun test tests/x.test.ts" }],
				scope_hint: ["docs/plans"], risk: "routine" as const, revision: 1, owner: "user",
			};
			const claimAt = "2026-08-12T00:00:00.000Z";
			seedKernelRunForTest(moved, {
				task_id: "task-other",
				enrollment_event_id: `enroll-task-other-${claimAt}`, created_at: claimAt, updated_at: claimAt,
				record: {
					contract: "assurance_kernel/task_record/v4", task_id: "task-other",
					intent_snapshot: intent,
					intent_ref: { path: "docs/plans/task-other.intent.json", content_hash: canonicalIntentHash(parseTaskIntentV1(intent)) },
					lifecycle: "active", artifact_state: "active", baseline: `sha256:${"a".repeat(64)}`,
					git_base_head: fx.base, attestations: [], findings: [], history: [],
				},
			});
			expect(readActiveClaimTaskId(moved)).toBe("task-other");
			await refuse(moved, "batch_lane_occupied", [moved]);
			expect(kernel.enrolled.size).toBe(0);
		} finally {
			fx.cleanup();
		}
	});

	it("enrolls the child into the Lane's own Authority Store through the shared Kernel port", async () => {
		const fx = fixture();
		try {
			const intent = {
				contract: "assurance_kernel/task_intent/v1", task_id: "task-a", goal: "enroll into a lane",
				acceptance: [{ id: "A1", assertion: "a1", verification: "bun test tests/x.test.ts" }],
				scope_hint: ["docs/plans"], risk: "routine" as const, revision: 1, owner: "user",
			};
			mkdirSync(join(fx.repo, "docs/plans"), { recursive: true });
			writeFileSync(join(fx.repo, "docs/plans/task-a.intent.json"), `${JSON.stringify(intent, null, 2)}\n`);
			git(fx.repo, "add", "-A");
			git(fx.repo, "commit", "-q", "-m", "intent");
			const base = git(fx.repo, "rev-parse", "HEAD");
			const prepared = preparePiCanary(fx.repo, { task_id: "task-a", now: CONFIRMED_AT });
			expect(prepared.intent).not.toBeNull();
			const planned: BatchPlanChild = {
				...child("task-a", "S1"),
				intent_path: prepared.intent!.path,
				intent_revision: prepared.intent!.revision,
				intent_content_hash: prepared.intent!.content_hash,
			};
			const args = request({ ...fx, base }, [planned], laneKernel());
			const binding = {
				batch_id: BATCH_ID, initiative_slug: SLUG, plan_digest: args.plan_digest, branch: "main", base_head: base,
				budget: args.budget, actor_id: "user", confirmation_ref: "confirm", nonce: "n",
			};
			const shared = createBatchKernelPort({
				root: fx.repo,
				enrollmentRegistry: createEnrollmentAuthorityRegistry(),
				registry: args.registry,
				capability: args.capability,
				binding,
				advanceTask: async () => ({ state: "completed" }),
				resume: { isResuming: false, existingBatch: null, batchBranch: BATCH_BRANCH },
				overrides: {
					validateBatchAuthorization: ({ registry, capability, binding: asked }) =>
						registry.inspect(capability, { ...asked, branch: "main", actor_id: "user", confirmation_ref: "confirm", nonce: "n" } as never),
				},
			});
			const real = { ...args, kernel: shared, base_head: base };
			await startBatch(real);
			const lane = fx.lane("task-a");
			expect(readActiveClaimTaskId(lane)).toBeNull();
			const report = lanes(await startBatch({ ...real, lane_offers: [{ task_id: "task-a", path: lane }] }));
			expect(report.children.map((c) => c.state)).toEqual(["enrolled"]);
			// The claim lives in the Lane's store; the coordinator's store holds none.
			expect(readActiveClaimTaskId(lane)).toBe("task-a");
			expect(readActiveClaimTaskId(fx.repo)).toBeNull();
			expect(existsSync(join(lane, ".imm/state/kernel.sqlite"))).toBe(true);
		} finally {
			fx.cleanup();
		}
	});

	it("never runs git worktree add or remove, checkout or switch from the lane modules", () => {
		const root = join(import.meta.dir, "../plugins/immune-brain/runtime/unattended");
		for (const file of ["batch_lanes.ts", "batch_integration.ts"]) {
			const source = readFileSync(join(root, file), "utf8");
			expect(source, file).not.toMatch(/["'`](worktree|checkout|switch)["'`]/);
		}
	});

	it("refuses a resume with a different max_parallel but accepts an absent one", async () => {
		const fx = fixture();
		try {
			const kernel = laneKernel();
			const args = request(fx, [child("task-a", "S1")], kernel);
			await startBatch(args);
			const mismatch = lanes(await startBatch({ ...args, max_parallel: 2 }));
			expect(mismatch.reason).toMatch(/^batch_parallel_mismatch/);
			const { max_parallel: _omitted, ...withoutParallel } = args;
			const resumed = lanes(await startBatch(withoutParallel));
			expect(resumed.max_parallel).toBe(1);
			expect(resumed.batch_state).toBe("running");
		} finally {
			fx.cleanup();
		}
	});

	it("keeps the serial contract when max_parallel is absent", async () => {
		const fx = fixture();
		try {
			const kernel = laneKernel();
			const { max_parallel: _omitted, ...serial } = request(fx, [child("task-a", "S1")], kernel);
			await startBatch(serial);
			expect(readAnyBatchRunState(fx.repo, BATCH_ID)?.contract).toBe("assurance_kernel/batch_run_state/v1");
		} finally {
			fx.cleanup();
		}
	});

	it("rejects a serial record when a resume adds max_parallel", async () => {
		const fx = fixture();
		try {
			const kernel = laneKernel();
			const { max_parallel: _omitted, ...serial } = request(fx, [child("task-a", "S1")], kernel);
			await startBatch(serial);
			const report = lanes(await runLaneBatch({ ...serial, max_parallel: 1 }, readAnyBatchRunState(fx.repo, BATCH_ID)));
			expect(report.reason).toMatch(/^batch_parallel_mismatch/);
		} finally {
			fx.cleanup();
		}
	});
});

describe("integration guard failure through the lane driver", () => {
	it("parks the child, skips its dependents, keeps the Lane and leaves the batch branch unmoved", async () => {
		// task-a's descriptor requires a file the delivery never has, so the rerun on the candidate fails.
		const fx = fixture({ "task-a": 'process.exit(require("node:fs").existsSync("never.txt") ? 0 : 1)' });
		try {
			const kernel = laneKernel();
			const children = [child("task-a", "S1"), child("task-b", "S2", ["task-a"])];
			const args = request(fx, children, kernel);
			await startBatch(args);
			const laneA = fx.lane("task-a");
			await startBatch({ ...args, lane_offers: [{ task_id: "task-a", path: laneA }] });
			writeFileSync(join(laneA, "a.txt"), "a\n");
			kernel.frozen.add("task-a");

			const report = lanes(await startBatch(args));
			expect(report.batch_state).toBe("needs_human");
			expect(report.children.map((c) => c.state)).toEqual(["needs_human", "skipped_blocked"]);
			expect(report.children[0]!.reason).toStartWith("batch_integration_check_failed:");
			expect(report.children[0]!.reason).not.toContain("batch_integration_check_failed: batch_integration_check_failed");
			expect(report.commits).toEqual([]);
			// The batch branch did not move and the Lane and its branch are kept with the committed delivery.
			expect(git(fx.repo, "rev-parse", "HEAD")).toBe(fx.base);
			expect(git(fx.repo, "rev-parse", BATCH_BRANCH)).toBe(fx.base);
			expect(existsSync(join(fx.repo, "a.txt"))).toBe(false);
			expect(report.children[0]!.lane).toMatchObject({ path: laneA, branch: laneBranchName(SLUG, "task-a") });
			expect(git(fx.repo, "rev-parse", laneBranchName(SLUG, "task-a"))).toBe(report.children[0]!.lane!.lane_commit!);
			expect(existsSync(laneA)).toBe(true);
		} finally {
			fx.cleanup();
		}
	});
});

describe("max_parallel above 1", () => {
	const wide = (fx: Fixture, kernel: LaneKernel, ids: string[], overrides: Partial<StartBatchInput> = {}) =>
		request(fx, ids.map((id, i) => child(id, `S${i + 1}`)), kernel, { max_parallel: 2, ...overrides });
	const offer = (fx: Fixture, ids: string[]) => ids.map((id) => ({ task_id: id, path: fx.lane(id) }));

	it("keeps two scope-disjoint children in flight together and integrates each as one commit", async () => {
		const fx = fixture({}, { "task-a": ["a.txt"], "task-b": ["b.txt"] });
		try {
			const kernel = laneKernel();
			const args = wide(fx, kernel, ["task-a", "task-b"]);
			const first = lanes(await startBatch(args));
			expect(first.handoffs?.map((h) => [h.role, h.task_id])).toEqual([
				["lane-steward", "task-a"],
				["lane-steward", "task-b"],
			]);
			const offers = offer(fx, ["task-a", "task-b"]);
			const second = lanes(await startBatch({ ...args, lane_offers: offers }));
			expect(second.children.map((c) => c.state)).toEqual(["enrolled", "enrolled"]);
			expect(second.handoffs?.map((h) => [h.role, h.task_id])).toEqual([
				["executor", "task-a"],
				["executor", "task-b"],
			]);
			writeFileSync(join(offers[0]!.path, "a.txt"), "a\n");
			writeFileSync(join(offers[1]!.path, "b.txt"), "b\n");
			kernel.frozen.add("task-a");
			kernel.frozen.add("task-b");
			const done = lanes(await startBatch(args));
			expect(done.batch_state).toBe("completed");
			expect(done.children.map((c) => c.state)).toEqual(["integrated", "integrated"]);
			expect(done.commits).toHaveLength(2);
			expect(git(fx.repo, "log", "--format=%s", `${fx.base}..HEAD`).split("\n").sort()).toEqual([
				"imm(task-a): deliver",
				"imm(task-b): deliver",
			]);
		} finally {
			fx.cleanup();
		}
	});

	it("makes a child whose scope overlaps an in-flight Lane wait and never exceeds max_parallel", async () => {
		const fx = fixture({}, { "task-a": ["a.txt"], "task-b": ["b.txt"], "task-c": ["a.txt"] });
		try {
			const kernel = laneKernel();
			const args = wide(fx, kernel, ["task-a", "task-b", "task-c"]);
			const first = lanes(await startBatch(args));
			expect(first.handoffs?.map((h) => h.task_id)).toEqual(["task-a", "task-b"]);
			const offers = offer(fx, ["task-a", "task-b"]);
			await startBatch({ ...args, lane_offers: offers });
			writeFileSync(join(offers[0]!.path, "a.txt"), "a\n");
			kernel.frozen.add("task-a");
			const next = lanes(await startBatch(args));
			// task-a integrated; task-c overlapped it and can now be provisioned from the new head.
			expect(next.children.map((c) => c.state)).toEqual(["integrated", "enrolled", "pending"]);
			expect(next.handoffs?.map((h) => [h.role, h.task_id])).toEqual([
				["executor", "task-b"],
				["lane-steward", "task-c"],
			]);
			expect(next.children.filter((c) => ["lane_admitted", "enrolled", "settled", "lane_committed"].includes(c.state))).toHaveLength(1);
		} finally {
			fx.cleanup();
		}
	});

	it("keeps a disjoint sibling moving when another Lane is lost, and records batch_lane_lost", async () => {
		const fx = fixture({}, { "task-a": ["a.txt"], "task-b": ["b.txt"] });
		try {
			const kernel = laneKernel();
			const args = wide(fx, kernel, ["task-a", "task-b"]);
			await startBatch(args);
			const offers = offer(fx, ["task-a", "task-b"]);
			await startBatch({ ...args, lane_offers: offers });
			kernel.enrolled.delete("task-a"); // task-a's claim vanished: nothing is inferred from terminal text
			writeFileSync(join(offers[1]!.path, "b.txt"), "b\n");
			kernel.frozen.add("task-b");
			const report = lanes(await startBatch(args));
			expect(report.children.map((c) => [c.state, c.reason])).toEqual([
				["needs_human", "batch_lane_lost"],
				["integrated", null],
			]);
			expect(report.batch_state).toBe("needs_human");
			expect(report.commits).toHaveLength(1);
			expect(git(fx.repo, "log", "--format=%s", `${fx.base}..HEAD`)).toBe("imm(task-b): deliver");
		} finally {
			fx.cleanup();
		}
	});

	it("applies qa_failure_limit to each child separately", async () => {
		const fx = fixture({}, { "task-a": ["a.txt"], "task-b": ["b.txt"] });
		try {
			const kernel = laneKernel();
			const args = wide(fx, kernel, ["task-a", "task-b"], { budget: { max_children: 2, qa_failure_limit: 1 } });
			await startBatch(args);
			const offers = offer(fx, ["task-a", "task-b"]);
			await startBatch({ ...args, lane_offers: offers });
			kernel.reworking.add("task-a");
			writeFileSync(join(offers[1]!.path, "b.txt"), "b\n");
			kernel.frozen.add("task-a");
			kernel.frozen.add("task-b");
			const report = lanes(await startBatch(args));
			expect(report.children.map((c) => c.state)).toEqual(["needs_human", "integrated"]);
			expect(report.children[0]!.qa_failures).toBe(1);
			expect(report.children[1]!.qa_failures).toBe(0);
			expect(report.batch_state).toBe("needs_human");
		} finally {
			fx.cleanup();
		}
	});

	it("no longer refuses max_parallel above 1", async () => {
		const fx = fixture();
		try {
			const report = lanes(await startBatch(request(fx, [child("task-a", "S1")], laneKernel(), { max_parallel: 2 })));
			expect(report.batch_state).toBe("running");
			expect(readAnyBatchRunState(fx.repo, BATCH_ID)).toMatchObject({ max_parallel: 2 });
		} finally {
			fx.cleanup();
		}
	});
});
