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
import { projectBatchPreflight, readActiveClaimTaskId } from "../plugins/immune-brain/runtime/unattended/batch_preflight";
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
	laneRejectionReport,
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
		overrides.confirmation_time ?? CONFIRMED_AT,
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
			expect(second.handoffs).toMatchObject([{ role: "executor", task_id: "task-a", lane_branch: laneBranchName(SLUG, "task-a"), lane_path: laneA }]);
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
			// task-a exhausted its own limit and waits for a coordinator correction
			// (#196) while task-b, under its own count, integrates.
			expect(report.children.map((c) => c.state)).toEqual(["enrolled", "integrated"]);
			expect(report.children[0]!.qa_failures).toBe(1);
			expect(report.children[0]!.correction_due).toBe("QA failure limit reached");
			expect(report.children[1]!.qa_failures).toBe(0);
			expect(report.batch_state).toBe("running");
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

/** The serial port, but each delivery also carries the child's tracked audit pair. */
function laneGitWithAudit(): BatchRunnerGitPort {
	const base = laneGit();
	return {
		...base,
		async commitChild(...args: Parameters<BatchRunnerGitPort["commitChild"]>) {
			const [root, taskId] = args;
			const dir = join(root, ".imm/audit", taskId, "run-1");
			mkdirSync(dir, { recursive: true });
			writeFileSync(join(dir, "task-record.json"), "{}\n");
			writeFileSync(join(dir, "terminal-proof.json"), "{}\n");
			git(root, "add", "-f", ".imm/audit");
			return base.commitChild(...args);
		},
	};
}

const releases = (report: BatchLaneRunReport) =>
	report.handoffs.filter((h) => h.role === "lane-steward" && h.action === "release");

/** Run task-a through its Lane to `integrated`; task-b stays pending behind it. */
async function integrateTaskA(fx: Fixture, gitPort: BatchRunnerGitPort) {
	const kernel = laneKernel();
	const children = [child("task-a", "S1"), child("task-b", "S2", ["task-a"])];
	const args = request(fx, children, kernel, { git: gitPort });
	await startBatch(args);
	const laneA = fx.lane("task-a");
	await startBatch({ ...args, lane_offers: [{ task_id: "task-a", path: laneA }] });
	writeFileSync(join(laneA, "a.txt"), "a\n");
	kernel.frozen.add("task-a");
	const report = lanes(await startBatch(args));
	return { args, kernel, laneA, report };
}

describe("lane release", () => {
	it("keeps safe release handoffs on a read-only store rejection without granting provision or execution", async () => {
		const fx = fixture();
		try {
			const { args, kernel, laneA } = await integrateTaskA(fx, laneGitWithAudit());
			const laneB = fx.lane("task-b");
			await startBatch({ ...args, lane_offers: [{ task_id: "task-b", path: laneB }] });
			kernel.frozen.add("task-b");
			const statePath = join(fx.repo, `.imm/state/batches/${BATCH_ID}.json`);
			const before = readFileSync(statePath, "utf8");
			const reject = () => startBatch({ ...args, kernel: { ...kernel,
				advanceTask: async () => { throw new Error("kernel store is busy"); },
			} });
			const report = lanes(await reject());
			expect(report.batch_state).toBe("rejected");
			expect(report.handoffs).toEqual([{ role: "lane-steward", action: "release", task_id: "task-a", lane_branch: laneBranchName(SLUG, "task-a") }]);
			expect(report.next_action).toContain("release handoff");
			expect(readFileSync(statePath, "utf8")).toBe(before);
			expect(existsSync(laneA)).toBe(true);
			writeFileSync(join(laneA, "scratch.txt"), "unsaved\n");
			expect(lanes(await reject()).handoffs).toEqual([]);
			rmSync(join(laneA, "scratch.txt"));
			const foreignIntent = parseTaskIntentV1(JSON.parse(intentJson("foreign-task")));
			const integratedHead = git(fx.repo, "rev-parse", "HEAD");
			git(fx.repo, "reset", "--hard", fx.base);
			const persisted = readAnyBatchRunState(fx.repo, BATCH_ID)!;
			if (persisted.contract !== "assurance_kernel/batch_run_state/v2") throw new Error("expected Lane record");
			expect(laneRejectionReport(args, persisted, "kernel store is busy", "retry").handoffs).toEqual([]);
			expect(readFileSync(statePath, "utf8")).toBe(before);
			git(fx.repo, "reset", "--hard", integratedHead);
			seedKernelRunForTest(laneA, { task_id: "foreign-task", record: {
				contract: "assurance_kernel/task_record/v4", task_id: "foreign-task",
				intent_snapshot: foreignIntent,
				intent_ref: { path: "docs/plans/foreign-task.intent.json", content_hash: canonicalIntentHash(foreignIntent) },
				lifecycle: "active", artifact_state: "active", baseline: `sha256:${"a".repeat(64)}`,
				git_base_head: git(laneA, "rev-parse", "HEAD"), attestations: [], findings: [], history: [],
			} });
			expect(lanes(await reject()).handoffs).toEqual([]);
			expect(readFileSync(statePath, "utf8")).toBe(before);
		} finally {
			fx.cleanup();
		}
	});

	it("offers release for an integrated clean Lane, records released once its path is gone, and keeps a present Lane integrated", async () => {
		const fx = fixture();
		try {
			const kernel = laneKernel();
			const children = [child("task-a", "S1"), child("task-b", "S2", ["task-a"])];
			const args = request(fx, children, kernel, { git: laneGitWithAudit() });
			await startBatch(args);
			const laneA = fx.lane("task-a");
			const enrolled = lanes(await startBatch({ ...args, lane_offers: [{ task_id: "task-a", path: laneA }] }));
			expect(releases(enrolled)).toEqual([]); // an unintegrated Lane is never offered for release

			writeFileSync(join(laneA, "a.txt"), "a\n");
			kernel.frozen.add("task-a");
			const third = lanes(await startBatch(args));
			expect(third.children.map((c) => c.state)).toEqual(["integrated", "pending"]);
			expect(releases(third)).toEqual([
				{ role: "lane-steward", action: "release", task_id: "task-a", lane_branch: laneBranchName(SLUG, "task-a") },
			]);
			// The runtime asked; it removed neither the worktree nor the branch.
			expect(existsSync(laneA)).toBe(true);
			expect(git(fx.repo, "rev-parse", "--verify", laneBranchName(SLUG, "task-a"))).toBeTruthy();

			// The steward (played by the test) removes the Lane; a later tick observes the path gone.
			git(fx.repo, "worktree", "remove", laneA);
			const laneB = fx.lane("task-b");
			const fourth = lanes(await startBatch({ ...args, lane_offers: [{ task_id: "task-b", path: laneB }] }));
			expect(fourth.children.map((c) => c.state)).toEqual(["released", "enrolled"]);
			expect(fourth.children[0]!.commit).toBe(third.commits[0]!);
			expect(fourth.children[0]!.lane).toMatchObject({ branch: laneBranchName(SLUG, "task-a") });
			expect(fourth.commits).toEqual(third.commits);
			expect(releases(fourth)).toEqual([]);

			// A Lane that is still present stays integrated and the batch still completes.
			writeFileSync(join(laneB, "b.txt"), "b\n");
			kernel.frozen.add("task-b");
			const done = lanes(await startBatch(args));
			expect(done.batch_state).toBe("completed");
			expect(done.children.map((c) => c.state)).toEqual(["released", "integrated"]);
			expect(releases(done)).toMatchObject([{ task_id: "task-b" }]);
			expect(existsSync(laneB)).toBe(true);
			expect(readAnyBatchRunState(fx.repo, BATCH_ID)).toMatchObject({ batch_state: "completed" });

			// A repeated call on the terminal batch still names the Lane left to release, and writes nothing.
			const again = lanes(await startBatch(args));
			expect(again.batch_state).toBe("completed");
			expect(releases(again)).toMatchObject([{ task_id: "task-b" }]);
			expect(again.children.map((c) => c.state)).toEqual(["released", "integrated"]);
		} finally {
			fx.cleanup();
		}
	});

	it("offers no release when the audit pair is not on the batch branch", async () => {
		const fx = fixture();
		try {
			const { report, laneA } = await integrateTaskA(fx, laneGit());
			expect(report.children.map((c) => c.state)).toEqual(["integrated", "pending"]);
			expect(existsSync(laneA)).toBe(true);
			expect(releases(report)).toEqual([]);
		} finally {
			fx.cleanup();
		}
	});

	it("offers no release while the Lane is dirty or switched off its branch, and offers it again once restored", async () => {
		const fx = fixture();
		try {
			const { args, laneA, report } = await integrateTaskA(fx, laneGitWithAudit());
			expect(releases(report)).toHaveLength(1);

			writeFileSync(join(laneA, "scratch.txt"), "unsaved\n");
			const dirty = lanes(await startBatch(args));
			expect(dirty.children[0]!.state).toBe("integrated");
			expect(releases(dirty)).toEqual([]);
			rmSync(join(laneA, "scratch.txt"));

			git(laneA, "checkout", "-q", "-b", "scratch-branch");
			const switched = lanes(await startBatch(args));
			expect(switched.children[0]!.state).toBe("integrated");
			expect(releases(switched)).toEqual([]);
			git(laneA, "checkout", "-q", laneBranchName(SLUG, "task-a"));

			const restored = lanes(await startBatch(args));
			expect(releases(restored)).toHaveLength(1);
		} finally {
			fx.cleanup();
		}
	});

	// The audit pair is reported reachable for every task, so only the child's own state can withhold release.
	const auditAlwaysReachable = (): BatchRunnerGitPort =>
		({
			...laneGitWithAudit(),
			lane: { ...createDefaultLaneGitPort(), auditReachable: () => true },
		}) as BatchRunnerGitPort;

	it("offers no release for a parked child even when its audit pair looks reachable", async () => {
		const fx = fixture({ "task-a": 'process.exit(require("node:fs").existsSync("never.txt") ? 0 : 1)' });
		try {
			const { report, laneA } = await integrateTaskA(fx, auditAlwaysReachable());
			expect(report.children.map((c) => c.state)).toEqual(["needs_human", "skipped_blocked"]);
			expect(existsSync(laneA)).toBe(true);
			expect(releases(report)).toEqual([]);
		} finally {
			fx.cleanup();
		}
	});

	it("offers no release for an enrolled Lane even when its audit pair looks reachable", async () => {
		const fx = fixture();
		try {
			const kernel = laneKernel();
			const children = [child("task-a", "S1"), child("task-b", "S2", ["task-a"])];
			const args = request(fx, children, kernel, { git: auditAlwaysReachable() });
			await startBatch(args);
			const laneA = fx.lane("task-a");
			const enrolled = lanes(await startBatch({ ...args, lane_offers: [{ task_id: "task-a", path: laneA }] }));
			expect(enrolled.children.map((c) => c.state)).toEqual(["enrolled", "pending"]);
			expect(releases(enrolled)).toEqual([]);
		} finally {
			fx.cleanup();
		}
	});

	it("finds the audit pair only as a complete pair for the named task on the given head", async () => {
		const fx = fixture();
		try {
			const port = createDefaultLaneGitPort();
			const dir = join(fx.repo, ".imm/audit/task-a/run-1");
			mkdirSync(dir, { recursive: true });
			writeFileSync(join(dir, "task-record.json"), "{}\n");
			git(fx.repo, "add", "-f", ".imm/audit");
			git(fx.repo, "commit", "-q", "-m", "half a pair");
			const half = git(fx.repo, "rev-parse", "HEAD");
			expect(port.auditReachable({ root: fx.repo, head: half, task_id: "task-a" })).toBe(false);

			writeFileSync(join(dir, "terminal-proof.json"), "{}\n");
			git(fx.repo, "add", "-f", ".imm/audit");
			git(fx.repo, "commit", "-q", "-m", "whole pair");
			const whole = git(fx.repo, "rev-parse", "HEAD");
			expect(port.auditReachable({ root: fx.repo, head: whole, task_id: "task-a" })).toBe(true);
			expect(port.auditReachable({ root: fx.repo, head: whole, task_id: "task-b" })).toBe(false);
			expect(port.auditReachable({ root: fx.repo, head: fx.base, task_id: "task-a" })).toBe(false);
		} finally {
			fx.cleanup();
		}
	});

	it("never deletes a branch or a worktree from the lane modules", () => {
		const root = join(import.meta.dir, "../plugins/immune-brain/runtime/unattended");
		for (const file of ["batch_lanes.ts", "batch_integration.ts"]) {
			const source = readFileSync(join(root, file), "utf8");
			expect(source, file).not.toMatch(/["'`]branch["'`]\s*,\s*["'`]-[dDm]/);
			expect(source, file).not.toMatch(/["'`](worktree|prune|rm)["'`]/);
			expect(source, file).not.toMatch(/\b(rmSync|unlinkSync|rmdirSync)\b/);
		}
	});
});

/**
 * The Parent Host's side of Lane Executor Supervision, played by the test: at
 * most one Executor session per Lane, launched from executor handoffs, and one
 * tick per session exit. A session is a scripted callback, not a real Host.
 */
function supervisor() {
	const live = new Set<string>();
	const launches = new Map<string, number>();
	return {
		live,
		launches,
		/** Launch a session for every executor handoff whose Lane has none. */
		launch(report: BatchLaneRunReport): string[] {
			const started: string[] = [];
			for (const handoff of report.handoffs) {
				if (handoff.role !== "executor" || live.has(handoff.task_id)) continue;
				live.add(handoff.task_id);
				launches.set(handoff.task_id, (launches.get(handoff.task_id) ?? 0) + 1);
				started.push(handoff.task_id);
			}
			return started;
		},
		/** The session ends; `work` is whatever it did in its Lane before exiting. */
		exit(taskId: string, work: () => void = () => {}): void {
			expect(live.has(taskId)).toBe(true);
			work();
			live.delete(taskId);
		},
	};
}

describe("Lane Executor supervision walkthrough", () => {
	it("runs S1 and S2 together, relaunches a session that exited without progress, starts S3 only after S1 integrated, and releases", async () => {
		const fx = fixture({}, { "task-a": ["a.txt"], "task-b": ["b.txt"], "task-c": ["c.txt"] });
		try {
			const kernel = laneKernel();
			const children = [child("task-a", "S1"), child("task-b", "S2"), child("task-c", "S3", ["task-a"])];
			const args = request(fx, children, kernel, { git: laneGitWithAudit(), max_parallel: 2 });
			const parent = supervisor();
			const deliver = (lane: string, taskId: string, file: string) => () => {
				writeFileSync(join(lane, file), `${taskId}\n`);
				kernel.frozen.add(taskId);
			};

			// Tick 1: only the two unblocked Slices get a Lane; nothing is launched yet.
			const first = lanes(await startBatch(args));
			expect(first.handoffs.map((h) => [h.role, h.task_id])).toEqual([
				["lane-steward", "task-a"],
				["lane-steward", "task-b"],
			]);
			expect(parent.launch(first)).toEqual([]);

			// Tick 2: both Lanes admitted; the Parent launches both sessions from one report.
			const laneA = fx.lane("task-a");
			const laneB = fx.lane("task-b");
			const second = lanes(
				await startBatch({ ...args, lane_offers: [{ task_id: "task-a", path: laneA }, { task_id: "task-b", path: laneB }] }),
			);
			expect(second.children.map((c) => c.state)).toEqual(["enrolled", "enrolled", "pending"]);
			expect(parent.launch(second)).toEqual(["task-a", "task-b"]);

			// S1's session exits having done nothing. The tick shows no progress and
			// offers the same executor handoff, so the Parent relaunches S1 only.
			parent.exit("task-a");
			const stalled = lanes(await startBatch(args));
			expect(stalled.children.map((c) => c.state)).toEqual(["enrolled", "enrolled", "pending"]);
			expect(stalled.commits).toEqual([]);
			expect(parent.launch(stalled)).toEqual(["task-a"]);
			expect(parent.launches.get("task-a")).toBe(2);
			expect(parent.launches.get("task-b")).toBe(1);

			// The relaunched S1 session delivers and exits: S1 integrates while S2 is
			// still in flight, S3 becomes provisionable, and S1's Lane is releasable.
			parent.exit("task-a", deliver(laneA, "task-a", "a.txt"));
			const third = lanes(await startBatch(args));
			expect(third.children.map((c) => c.state)).toEqual(["integrated", "enrolled", "pending"]);
			expect(third.handoffs.map((h) => [h.role, h.task_id])).toContainEqual(["lane-steward", "task-c"]);
			expect(releases(third).map((h) => h.task_id)).toEqual(["task-a"]);
			expect(parent.launch(third)).toEqual([]); // S2 already has its session

			// The steward releases S1's Lane and provisions S3's from the new batch head.
			git(fx.repo, "worktree", "remove", laneA);
			const laneC = fx.lane("task-c");
			expect(existsSync(join(laneC, "a.txt"))).toBe(true);
			const fourth = lanes(await startBatch({ ...args, lane_offers: [{ task_id: "task-c", path: laneC }] }));
			expect(fourth.children.map((c) => c.state)).toEqual(["released", "enrolled", "enrolled"]);
			expect(parent.launch(fourth)).toEqual(["task-c"]);
			expect([...parent.live].sort()).toEqual(["task-b", "task-c"]);

			// Both remaining sessions exit before the next tick; one tick settles both.
			parent.exit("task-b", deliver(laneB, "task-b", "b.txt"));
			parent.exit("task-c", deliver(laneC, "task-c", "c.txt"));
			const done = lanes(await startBatch(args));
			expect(done.batch_state, JSON.stringify(done)).toBe("completed");
			expect(done.children.map((c) => c.state)).toEqual(["released", "integrated", "integrated"]);
			expect(done.commits).toHaveLength(3);
			expect(releases(done).map((h) => h.task_id)).toEqual(["task-b", "task-c"]);
			expect(parent.launch(done)).toEqual([]);
			expect(parent.live.size).toBe(0);
			expect(git(fx.repo, "log", "--format=%s", `${fx.base}..HEAD`).split("\n").sort()).toEqual([
				"imm(task-a): deliver",
				"imm(task-b): deliver",
				"imm(task-c): deliver",
			]);
		} finally {
			fx.cleanup();
		}
	}, 20000);
});

describe("lane reader and guidance accuracy", () => {
	it("requires a genuinely fresh Batch Authorization and resumes the same resolved parked run", async () => {
		const fx = fixture();
		try {
			const kernel = laneKernel();
			const children = [child("task-a", "S1"), child("task-b", "S2", ["task-a"])];
			const budget = { max_children: 2, qa_failure_limit: 1 };
			const args = request(fx, children, kernel, { budget });
			await startBatch(args);
			const laneA = fx.lane("task-a");
			await startBatch({ ...args, lane_offers: [{ task_id: "task-a", path: laneA }] });
			writeFileSync(join(laneA, "a.txt"), "a\n");
			kernel.reworking.add("task-a");
			kernel.frozen.add("task-a");
			// The child parks only after both coordinator corrections are spent (#196).
			const { parseLaneInstruction } = await import("../plugins/immune-brain/runtime/unattended/batch_lanes");
			for (const round of [1, 2]) {
				await startBatch(args);
				kernel.frozen.delete("task-a");
				await startBatch({ ...args, lane_instruction: parseLaneInstruction({ task_id: "task-a", kind: "correction", text: `correction ${round}`, session_state: "idle" }) });
				kernel.frozen.add("task-a");
			}
			const parked = lanes(await startBatch(args));
			expect(parked.batch_state).toBe("needs_human");
			expect(parked.next_action).toContain("lane batch has stopped");
			expect(parked.next_action).toContain("Lane is kept");
			expect(parked.next_action).toContain("new Batch Authorization");

			const again = lanes(await startBatch({ ...args, confirmation_time: "2026-06-01T00:00:00.000Z" }));
			expect(again.batch_state).toBe("needs_human");
			expect(again.children).toEqual(parked.children);
			expect(again.commits).toEqual(parked.commits);
			kernel.reworking.delete("task-a");
			kernel.frozen.delete("task-a");
			const fresh = request(fx, children, kernel, { budget, confirmation_time: "2026-06-01T00:00:00.000Z" });
			const statePath = join(fx.repo, `.imm/state/batches/${BATCH_ID}.json`);
			const parkedBytes = readFileSync(statePath, "utf8");
			const project = kernel.projectTask;
			for (const overrides of [{ run_id: "foreign-run" }, { open_user_decision_count: 1 }, { replan_required_ids: ["decision"] }, { lifecycle: "stopped" as const }]) {
				const blocked = lanes(await startBatch({ ...fresh, kernel: { ...kernel,
					projectTask: async (root, id) => {
						const result = await project(root, id);
						return { ...result, projection: { ...result.projection, ...overrides } };
					},
				} }));
				expect(blocked.batch_state).toBe("needs_human");
				expect(readFileSync(statePath, "utf8")).toBe(parkedBytes);
			}
			// Production ownership observes consumed slots on the new capability.
			fresh.kernel = { ...fresh.kernel, ownsTaskClaim: id => fresh.registry.isChildConsumed(fresh.capability, id) };
			expect(fresh.kernel.ownsTaskClaim("task-a")).toBe(false);
			const resumed = lanes(await startBatch(fresh));
			expect(fresh.kernel.ownsTaskClaim("task-a")).toBe(true);
			expect(resumed.batch_state, resumed.reason ?? "").toBe("running");
			expect(resumed.children.map(c => c.state)).toEqual(["enrolled", "pending"]);
			expect(resumed.children[0]!.lane?.run_id).toBe(parked.children[0]!.lane?.run_id);
			expect(kernel.enrolled.size).toBe(1);
			kernel.settled.add("task-a");
			const settled = lanes(await startBatch(fresh));
			expect(settled.children[0]!.state).toBe("integrated");
			expect(settled.commits).toHaveLength(1);
			expect(lanes(await startBatch(fresh)).commits).toEqual(settled.commits);
			expect(existsSync(laneA)).toBe(true);
		} finally {
			fx.cleanup();
		}
	});

	it("names the provision guidance only when a handoff has action provision", async () => {
		const fx = fixture({}, { "task-a": ["a.txt"], "task-b": ["b.txt"] });
		try {
			const kernel = laneKernel();
			const children = [child("task-a", "S1"), child("task-b", "S2")];
			const args = request(fx, children, kernel, { max_parallel: 2, git: laneGitWithAudit() });
			const first = lanes(await startBatch(args));
			expect(first.handoffs.map((h) => h.role === "lane-steward" && h.action)).toEqual(["provision", "provision"]);
			expect(first.next_action).toContain("Provide a Lane");

			const offers = [
				{ task_id: "task-a", path: fx.lane("task-a") },
				{ task_id: "task-b", path: fx.lane("task-b") },
			];
			await startBatch({ ...args, lane_offers: offers });
			writeFileSync(join(offers[0]!.path, "a.txt"), "a\n");
			kernel.frozen.add("task-a");
			// task-a integrates and is offered for release while task-b is still an executor handoff.
			const mixed = lanes(await startBatch(args));
			expect(mixed.children.map((c) => c.state)).toEqual(["integrated", "enrolled"]);
			expect(mixed.handoffs.map((h) => (h.role === "lane-steward" ? h.action : h.role)).sort()).toEqual(["executor", "release"]);
			expect(mixed.next_action).not.toContain("Provide a Lane");
			expect(mixed.next_action).toContain("Run each executor handoff");
		} finally {
			fx.cleanup();
		}
	});

	it("reports a store-condition rejection of a lane batch with its persisted lane children, not an empty serial plan", async () => {
		const fx = fixture();
		try {
			const kernel = laneKernel();
			const children = [child("task-a", "S1"), child("task-b", "S2", ["task-a"])];
			const args = request(fx, children, kernel);
			await startBatch(args);
			const laneA = fx.lane("task-a");
			const enrolled = lanes(await startBatch({ ...args, lane_offers: [{ task_id: "task-a", path: laneA }] }));
			expect(enrolled.children.map((c) => c.state)).toEqual(["enrolled", "pending"]);

			kernel.frozen.add("task-a");
			const busy = {
				...kernel,
				advanceTask: async () => {
					throw new Error("kernel store is busy");
				},
			} as unknown as BatchRunnerKernelPort;
			const rejected = lanes(await startBatch({ ...args, kernel: busy }));
			expect(rejected.batch_state).toBe("rejected");
			expect(rejected.reason).toContain("kernel store is busy");
			expect(rejected.max_parallel).toBe(1);
			expect(Array.isArray(rejected.handoffs)).toBe(true);
			expect(rejected.children.map((c) => [c.task_id, c.state])).toEqual([
				["task-a", "enrolled"],
				["task-b", "pending"],
			]);
			expect(rejected.children[0]!.lane).toMatchObject({ path: laneA });
			expect(rejected as unknown as Record<string, unknown>).not.toHaveProperty("handoff");
			// Nothing was written for the rejection.
			expect(readAnyBatchRunState(fx.repo, BATCH_ID)).toMatchObject({ batch_state: "running" });
		} finally {
			fx.cleanup();
		}
	});

	it("shows an integrated or released lane child as already_settled in the resume plan, never enrollable", async () => {
		const fx = fixture();
		try {
			const { args, laneA, report } = await integrateTaskA(fx, laneGitWithAudit());
			expect(report.children.map((c) => c.state)).toEqual(["integrated", "pending"]);
			const status = async () => {
				const outcome = await projectBatchPreflight({ root: fx.repo, initiative_slug: SLUG, now: FAR_FUTURE });
				if (!outcome.ok) throw new Error(`preflight rejected: ${JSON.stringify(outcome)}`);
				return outcome.projection.recovery_children.map((c) => [c.task_id, c.status]);
			};
			expect(await status()).toEqual([
				["task-a", "already_settled"],
				["task-b", "enrollable"],
			]);
			git(fx.repo, "worktree", "remove", laneA);
			// The next tick observes the Lane gone and records released; that child stays settled too.
			const released = lanes(await startBatch(args));
			expect(released.children[0]!.state).toBe("released");
			expect(await status()).toEqual([
				["task-a", "already_settled"],
				["task-b", "enrollable"],
			]);
		} finally {
			fx.cleanup();
		}
	});
});

describe("Child Issue closure after integration (#197)", () => {
	/** Commits a real done terminal proof with the delivery, as a Lane settlement exports it. */
	function laneGitWithProof(): BatchRunnerGitPort {
		const base = laneGit();
		return {
			...base,
			async commitChild(...args: Parameters<BatchRunnerGitPort["commitChild"]>) {
				const [root, taskId] = args;
				const dir = join(root, ".imm/audit", taskId, "run-1");
				mkdirSync(dir, { recursive: true });
				writeFileSync(join(dir, "task-record.json"), "{}\n");
				writeFileSync(join(dir, "terminal-proof.json"), `${JSON.stringify({
					contract: "assurance_kernel/task_tombstone/v2", task_id: taskId, lifecycle_status: "terminal",
					terminal_lifecycle: "done", terminal_event_id: `ev-${taskId}`, final_record_hash: `sha256:${"c".repeat(64)}`,
					terminalized_at: "2026-10-10T00:00:00.000Z",
				})}\n`);
				git(root, "add", "-f", ".imm/audit");
				return base.commitChild(...args);
			},
		};
	}
	function recordingTracker(failFirst = false) {
		const calls: Array<{ task_id: string; terminal_event_id: string }> = [];
		let failures = failFirst ? 1 : 0;
		return {
			calls,
			port: {
				async markTerminal(_root: string, input: { task_id: string; phase: "done"; terminal_event_id: string }) {
					calls.push({ task_id: input.task_id, terminal_event_id: input.terminal_event_id });
					if (failures-- > 0) return { status: "retryable_failure", message: "gh unavailable" };
					return { status: "updated", message: "terminal Task Issue closure confirmed" };
				},
			},
		};
	}

	it("closes nothing while the child is only enrolled or settled in its Lane, then closes it exactly once after integration", async () => {
		const fx = fixture();
		try {
			const kernel = laneKernel();
			const tracker = recordingTracker();
			const children = [child("task-a", "S1"), child("task-b", "S2", ["task-a"])];
			const args = request(fx, children, kernel, { git: laneGitWithProof(), tracker: tracker.port });
			await startBatch(args);
			const laneA = fx.lane("task-a");
			await startBatch({ ...args, lane_offers: [{ task_id: "task-a", path: laneA }] });
			expect(tracker.calls).toEqual([]);
			writeFileSync(join(laneA, "a.txt"), "a\n");
			kernel.frozen.add("task-a");
			const integrated = lanes(await startBatch(args));
			expect(integrated.children[0]).toMatchObject({ state: "integrated", tracker_closed: true });
			expect(integrated.tracker_observations).toEqual([{ task_id: "task-a", status: "updated", message: "terminal Task Issue closure confirmed" }]);
			expect(tracker.calls).toEqual([{ task_id: "task-a", terminal_event_id: "ev-task-a" }]);
			// Later ticks never close it again.
			const again = lanes(await startBatch(args));
			expect(again.tracker_observations).toBeUndefined();
			expect(tracker.calls).toHaveLength(1);
		} finally {
			fx.cleanup();
		}
	});

	it("retries a failed close on the next tick without changing batch state", async () => {
		const fx = fixture();
		try {
			const kernel = laneKernel();
			const tracker = recordingTracker(true);
			const args = request(fx, [child("task-a", "S1")], kernel, { git: laneGitWithProof(), tracker: tracker.port });
			await startBatch(args);
			const laneA = fx.lane("task-a");
			await startBatch({ ...args, lane_offers: [{ task_id: "task-a", path: laneA }] });
			writeFileSync(join(laneA, "a.txt"), "a\n");
			kernel.frozen.add("task-a");
			const done = lanes(await startBatch(args));
			expect(done.batch_state).toBe("completed");
			expect(done.children[0]!.tracker_closed).toBeUndefined();
			expect(done.tracker_observations?.[0]).toMatchObject({ task_id: "task-a", status: "retryable_failure" });
			const retried = lanes(await startBatch(args));
			expect(retried.batch_state).toBe("completed");
			expect(retried.children[0]!.tracker_closed).toBe(true);
			expect(tracker.calls).toHaveLength(2);
		} finally {
			fx.cleanup();
		}
	});

	it("keeps the Child open when the child is parked as batch_lane_lost", async () => {
		const fx = fixture({}, { "task-a": ["a.txt"], "task-b": ["b.txt"] });
		try {
			const kernel = laneKernel();
			const tracker = recordingTracker();
			const args = request(fx, [child("task-a", "S1"), child("task-b", "S2")], kernel, { git: laneGitWithProof(), tracker: tracker.port, max_parallel: 2 });
			await startBatch(args);
			const offers = ["task-a", "task-b"].map((id) => ({ task_id: id, path: fx.lane(id) }));
			await startBatch({ ...args, lane_offers: offers });
			kernel.enrolled.delete("task-a");
			writeFileSync(join(offers[1]!.path, "b.txt"), "b\n");
			kernel.frozen.add("task-b");
			const report = lanes(await startBatch(args));
			expect(report.children.map((c) => c.state)).toEqual(["needs_human", "integrated"]);
			expect(tracker.calls.map((c) => c.task_id)).toEqual(["task-b"]);
		} finally {
			fx.cleanup();
		}
	});

	it("skips the tracker write for a settlement inside the child's own Lane only", async () => {
		const { projectTerminalTrackerState } = await import("../plugins/immune-brain/runtime/assurance/coordinator");
		const { isLaneWorkspaceForTask } = await import("../plugins/immune-brain/runtime/unattended/lane_workspace");
		const fx = fixture();
		try {
			const laneA = fx.lane("task-a");
			expect(isLaneWorkspaceForTask(laneA, "task-a")).toBe(true);
			expect(isLaneWorkspaceForTask(laneA, "task-b")).toBe(false);
			expect(isLaneWorkspaceForTask(fx.repo, "task-a")).toBe(false);
			const calls: string[] = [];
			const settle = (root: string) => projectTerminalTrackerState({
				root,
				task_id: "task-a",
				projection: { error: null, claim: null, projection: projectionBody({ lifecycle: "done" }) } as AssuranceProjectionResult,
				tombstone: { contract: "assurance_kernel/task_tombstone/v2", task_id: "task-a", lifecycle_status: "terminal", terminal_lifecycle: "done", terminal_event_id: "ev-a", final_record_hash: `sha256:${"c".repeat(64)}`, terminalized_at: "2026-10-10T00:00:00.000Z" },
				markTerminal: async (r) => { calls.push(r); return { contract: "immune_brain/github_issue_tracker_result/v1", operation: "mark-terminal", status: "updated", association_found: true, message: "ok" }; },
			});
			expect(await settle(laneA)).toBeUndefined();
			expect(calls).toEqual([]);
			// A serial batch or single task settles on the coordinator branch and projects as before.
			expect((await settle(fx.repo))?.status).toBe("updated");
			expect(calls).toEqual([fx.repo]);
		} finally {
			fx.cleanup();
		}
	});
});

describe("runtime contract preflight and mismatch park reason (#199)", () => {
	function runtimeDir(fx: Fixture, overrides: Record<string, unknown>): string {
		const dir = join(fx.dir, "lane-runtime");
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, "runtime_contracts.json"), JSON.stringify({
			contract: "immune_brain/runtime_contracts/v1",
			task_record: "assurance_kernel/task_record/v4",
			task_tombstone: "assurance_kernel/task_tombstone/v2",
			assurance_projection: "assurance_kernel/assurance_projection/v1",
			kernel_store_schema: 1,
			...overrides,
		}));
		return dir;
	}

	it("ships a manifest equal to the running runtime's identifiers, so this repository passes with no refusal", async () => {
		const { RUNTIME_CONTRACTS, readRuntimeContracts } = await import("../plugins/immune-brain/runtime/kernel/runtime_contracts");
		const { laneRuntimeContractRefusal } = await import("../plugins/immune-brain/runtime/unattended/batch_lanes");
		const root = join(import.meta.dir, "..");
		expect(readRuntimeContracts(root)?.contracts).toEqual(RUNTIME_CONTRACTS);
		expect(laneRuntimeContractRefusal(root)).toBeNull();
	});

	it("refuses a new lane batch before any Lane exists when the Lane runtime writes another TaskRecord contract, naming both sources", async () => {
		const fx = fixture();
		try {
			// Same plugin version on both sides is irrelevant: only identifiers are compared.
			const lane = runtimeDir(fx, { task_record: "assurance_kernel/task_record/v3" });
			const kernel = laneKernel();
			const report = lanes(await startBatch(request(fx, [child("task-a", "S1")], kernel, { executor_runtime: lane })));
			expect(report.batch_state).toBe("rejected");
			expect(report.reason).toStartWith("batch_runtime_contract_mismatch:");
			expect(report.reason).toContain("task_record: assurance_kernel/task_record/v4 != assurance_kernel/task_record/v3");
			expect(report.reason).toContain(join(lane, "runtime_contracts.json"));
			expect(report.reason).toContain("plugins/immune-brain/runtime/kernel");
			expect(report.handoffs).toEqual([]);
			expect(readAnyBatchRunState(fx.repo, BATCH_ID)).toBeNull();
			expect(git(fx.repo, "rev-parse", "HEAD")).toBe(fx.base);
		} finally {
			fx.cleanup();
		}
	});

	it("starts normally when the identifiers match", async () => {
		const fx = fixture();
		try {
			const report = lanes(await startBatch(request(fx, [child("task-a", "S1")], laneKernel(), { executor_runtime: runtimeDir(fx, {}) })));
			expect(report.batch_state).toBe("running");
			expect(report.handoffs.map((h) => h.role)).toEqual(["lane-steward"]);
		} finally {
			fx.cleanup();
		}
	});

	it("parks a Lane whose state exists but is in a contract the coordinator refuses with its own reason and the parse error", async () => {
		const fx = fixture();
		try {
			const kernel = laneKernel();
			const args = request(fx, [child("task-a", "S1")], kernel);
			await startBatch(args);
			const laneA = fx.lane("task-a");
			await startBatch({ ...args, lane_offers: [{ task_id: "task-a", path: laneA }] });
			const parseError = "contract must equal assurance_kernel/task_record/v3; unknown field: git_base_head";
			const project = kernel.projectTask;
			kernel.projectTask = async (root, taskId) => ({ ...(await project(root, taskId)), error: parseError });
			const report = lanes(await startBatch(args));
			expect(report.children[0]!.state).toBe("needs_human");
			expect(report.children[0]!.reason).toBe(`batch_lane_contract_mismatch: ${parseError}`);
			// A genuinely missing Lane keeps batch_lane_lost.
			expect(report.children[0]!.reason).not.toBe("batch_lane_lost");
		} finally {
			fx.cleanup();
		}
	});
});

describe("Lane write guard and leak restore (#200)", () => {
	it("refuses an edit or write from inside a Lane to the coordinator checkout, on both Hosts, and nothing else", async () => {
		const { laneEditRefusal } = await import("../plugins/immune-brain/.pi-extension/imm-canary-work");
		const { laneGuardHookOutput } = await import("../plugins/immune-brain/runtime/claude/lane_guard");
		const fx = fixture();
		try {
			const laneA = fx.lane("task-a");
			const outside = join(fx.repo, "base.txt");
			// Pi
			expect(laneEditRefusal({ toolName: "edit", input: { path: outside } }, laneA)).toContain(`stays under ${laneA}`);
			expect(laneEditRefusal({ toolName: "write", input: { path: "../repo/new.txt" } }, laneA)).toContain("is outside this Lane");
			expect(laneEditRefusal({ toolName: "write", input: { path: "a.txt" } }, laneA)).toBeNull();
			expect(laneEditRefusal({ toolName: "edit", input: { path: join(laneA, "deep/new.txt") } }, laneA)).toBeNull();
			expect(laneEditRefusal({ toolName: "bash", input: { command: `echo x > ${outside}` } }, laneA)).toBeNull();
			expect(laneEditRefusal({ toolName: "edit", input: { path: outside } }, fx.repo)).toBeNull();
			// Claude Code
			const deny = laneGuardHookOutput({ hook_event_name: "PreToolUse", tool_name: "Write", cwd: laneA, tool_input: { file_path: outside } });
			expect(JSON.parse(deny!)).toMatchObject({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny" } });
			expect(JSON.parse(deny!).hookSpecificOutput.permissionDecisionReason).toContain(laneA);
			expect(laneGuardHookOutput({ hook_event_name: "PreToolUse", tool_name: "Edit", cwd: laneA, tool_input: { file_path: join(laneA, "a.txt") } })).toBeNull();
			expect(laneGuardHookOutput({ hook_event_name: "PreToolUse", tool_name: "Bash", cwd: laneA, tool_input: { command: "true" } })).toBeNull();
			expect(laneGuardHookOutput({ hook_event_name: "PreToolUse", tool_name: "Write", cwd: fx.repo, tool_input: { file_path: outside } })).toBeNull();
		} finally {
			fx.cleanup();
		}
	});

	async function enrolledLane(fx: Fixture) {
		const kernel = laneKernel();
		const args = request(fx, [child("task-a", "S1")], kernel);
		await startBatch(args);
		const laneA = fx.lane("task-a");
		await startBatch({ ...args, lane_offers: [{ task_id: "task-a", path: laneA }] });
		return { laneA };
	}
	const preflight = () => projectBatchPreflight({ root: fx_root!, initiative_slug: SLUG, now: FAR_FUTURE });
	let fx_root: string | null = null;

	it("restores leaked Lane writes whose bytes are provably the Lane's, backs them up reversibly, and records the backup", async () => {
		const fx = fixture();
		fx_root = fx.repo;
		try {
			const { laneA } = await enrolledLane(fx);
			writeFileSync(join(laneA, "a.txt"), "lane a\n");
			writeFileSync(join(laneA, "base.txt"), "lane edit\n");
			// The Executor wrote the same bytes into the coordinator by absolute path.
			writeFileSync(join(fx.repo, "a.txt"), "lane a\n");
			writeFileSync(join(fx.repo, "base.txt"), "lane edit\n");
			const outcome = await preflight();
			expect(outcome.ok).toBe(true);
			expect(git(fx.repo, "status", "--porcelain")).toBe("");
			expect(readFileSync(join(fx.repo, "base.txt"), "utf8")).toBe("base\n");
			const record = readAnyBatchRunState(fx.repo, BATCH_ID) as { restores?: Array<{ backup: string; paths: Array<{ path: string; kind: string; lane_task_id: string }> }> };
			expect(record.restores).toHaveLength(1);
			const restore = record.restores![0]!;
			expect(restore.paths.map((p) => [p.path, p.kind, p.lane_task_id]).sort()).toEqual([["a.txt", "untracked", "task-a"], ["base.txt", "modified", "task-a"]]);
			// Reversible: the backup holds both files and the patch.
			expect(readFileSync(join(fx.repo, restore.backup, "files/a.txt"), "utf8")).toBe("lane a\n");
			expect(readFileSync(join(fx.repo, restore.backup, "files/base.txt"), "utf8")).toBe("lane edit\n");
			expect(readFileSync(join(fx.repo, restore.backup, "restore.patch"), "utf8")).toContain("+lane edit");
			// The next report carries the backup location.
			const report = lanes(await startBatch(request(fx, [child("task-a", "S1")], laneKernel())));
			expect(report.restores?.[0]?.backup).toBe(restore.backup);
		} finally {
			fx.cleanup();
		}
	});

	it("touches no file when any change has unknown origin, and never restores the user's own staged work", async () => {
		const fx = fixture();
		fx_root = fx.repo;
		try {
			const { laneA } = await enrolledLane(fx);
			writeFileSync(join(laneA, "a.txt"), "lane a\n");
			writeFileSync(join(fx.repo, "a.txt"), "lane a\n");
			writeFileSync(join(fx.repo, "notes.txt"), "the user's own notes\n");
			const mixed = await preflight();
			expect(mixed.ok).toBe(false);
			expect((mixed as { reason: string }).reason).toContain("notes.txt: its bytes match no Lane of this batch");
			expect((mixed as { recovery_action: string }).recovery_action).not.toContain("git add");
			expect(readFileSync(join(fx.repo, "a.txt"), "utf8")).toBe("lane a\n");
			expect(readFileSync(join(fx.repo, "notes.txt"), "utf8")).toBe("the user's own notes\n");
			expect((readAnyBatchRunState(fx.repo, BATCH_ID) as { restores?: unknown }).restores).toBeUndefined();

			rmSync(join(fx.repo, "notes.txt"));
			git(fx.repo, "add", "a.txt"); // staged: a user act, not a Lane write
			await preflight();
			expect((readAnyBatchRunState(fx.repo, BATCH_ID) as { restores?: unknown }).restores).toBeUndefined();
			expect(git(fx.repo, "diff", "--cached", "--name-only")).toBe("a.txt");
			expect(existsSync(join(fx.repo, "a.txt"))).toBe(true);
		} finally {
			fx.cleanup();
		}
	});
});

describe("final verification in the completion report (#201)", () => {
	for (const [label, commands, passed] of [["passes", ["git status"], true], ["fails", ["git status", "git no-such-subcommand"], false]] as const) {
		it(`runs the recorded commands on the batch branch once every child is integrated and ${label}`, async () => {
			const fx = fixture();
			try {
				const kernel = laneKernel();
				const args = request(fx, [child("task-a", "S1")], kernel, { final_verification: [...commands] });
				await startBatch(args);
				const laneA = fx.lane("task-a");
				// A resume never replaces the recorded commands.
				await startBatch({ ...args, final_verification: ["git no-such-subcommand"], lane_offers: [{ task_id: "task-a", path: laneA }] });
				writeFileSync(join(laneA, "a.txt"), "a\n");
				kernel.frozen.add("task-a");
				const done = lanes(await startBatch(args));
				expect(done.batch_state).toBe("completed");
				expect(done.final_verification?.passed).toBe(passed);
				expect(done.final_verification?.results.map((r) => r.command)).toEqual([...commands]);
				expect(done.final_verification?.head).toBe(done.commits[0]);
				if (!passed) expect(done.reason).toContain("final verification did not pass: git no-such-subcommand");
				// Integrated commits stay.
				expect(git(fx.repo, "rev-parse", "HEAD")).toBe(done.commits[0]!);
				const persisted = JSON.parse(readFileSync(join(fx.repo, `.imm/state/batches/${BATCH_ID}.report.json`), "utf8"));
				expect(persisted.final_verification.passed).toBe(passed);
			} finally {
				fx.cleanup();
			}
		});
	}
});

describe("coordinator instruction to a Lane session (#195)", () => {
	it("records an instruction to an idle Lane session before it is sent, and the Lane then continues to integration", async () => {
		const { parseLaneInstruction } = await import("../plugins/immune-brain/runtime/unattended/batch_lanes");
		const fx = fixture();
		try {
			const kernel = laneKernel();
			const args = request(fx, [child("task-a", "S1")], kernel);
			await startBatch(args);
			const laneA = fx.lane("task-a");
			await startBatch({ ...args, lane_offers: [{ task_id: "task-a", path: laneA }] });
			const text = "Read scenarios from the single marker source; stop parsing the visible Markdown.";
			const sent = lanes(await startBatch({ ...args, lane_instruction: parseLaneInstruction({ task_id: "task-a", text, session_state: "idle" }) }));
			expect(sent.lane_instruction).toEqual({ task_id: "task-a", kind: "instruction", accepted: true, reason: null });
			expect(sent.interventions).toHaveLength(1);
			expect(sent.interventions![0]).toMatchObject({ task_id: "task-a", kind: "instruction", text });
			expect(sent.interventions![0]!.text_digest).toMatch(/^sha256:[0-9a-f]{64}$/);
			// The child is still the Executor's: the handoff is unchanged.
			expect(sent.handoffs.map((h) => [h.role, h.task_id])).toEqual([["executor", "task-a"]]);
			// After the correction the session delivers and the child integrates; the record keeps the intervention.
			writeFileSync(join(laneA, "a.txt"), "a\n");
			kernel.frozen.add("task-a");
			const done = lanes(await startBatch(args));
			expect(done.batch_state).toBe("completed");
			expect(done.interventions).toHaveLength(1);
			const persisted = JSON.parse(readFileSync(join(fx.repo, `.imm/state/batches/${BATCH_ID}.report.json`), "utf8"));
			expect(persisted.interventions[0].text).toBe(text);
		} finally {
			fx.cleanup();
		}
	});

	it("refuses and records nothing while the Lane session is blocked, working, or the child is not running in its Lane", async () => {
		const { parseLaneInstruction } = await import("../plugins/immune-brain/runtime/unattended/batch_lanes");
		const fx = fixture();
		try {
			const kernel = laneKernel();
			const args = request(fx, [child("task-a", "S1"), child("task-b", "S2", ["task-a"])], kernel);
			await startBatch(args);
			const laneA = fx.lane("task-a");
			await startBatch({ ...args, lane_offers: [{ task_id: "task-a", path: laneA }] });
			const ask = async (task_id: string, session_state: string) =>
				lanes(await startBatch({ ...args, lane_instruction: parseLaneInstruction({ task_id, text: "fix it", session_state }) })).lane_instruction!;
			const blocked = await ask("task-a", "blocked");
			expect(blocked.accepted).toBe(false);
			expect(blocked.reason).toContain("blocked on a dialog only the user may answer");
			expect((await ask("task-a", "working")).accepted).toBe(false);
			expect((await ask("task-b", "idle")).reason).toContain("task-b has no Lane");
			expect((readAnyBatchRunState(fx.repo, BATCH_ID) as { interventions?: unknown }).interventions).toBeUndefined();
			expect(() => parseLaneInstruction({ task_id: "task-a", text: "", session_state: "idle" })).toThrow();
			expect(() => parseLaneInstruction({ task_id: "task-a", text: "x", session_state: "asleep" })).toThrow();
			expect(() => parseLaneInstruction({ task_id: "task-a", text: "x", session_state: "idle", keys: "y" })).toThrow(/unknown/);
		} finally {
			fx.cleanup();
		}
	});
});

describe("coordinator correction when the rework budget is exhausted (#196)", () => {
	it("hands the child to the coordinator up to twice, each time to a new session, then parks it with its own reason while a sibling integrates", async () => {
		const { parseLaneInstruction, CORRECTION_LIMIT_REACHED } = await import("../plugins/immune-brain/runtime/unattended/batch_lanes");
		const fx = fixture({}, { "task-a": ["a.txt"], "task-b": ["b.txt"] });
		try {
			const kernel = laneKernel();
			const args = request(fx, [child("task-a", "S1"), child("task-b", "S2")], kernel, { max_parallel: 2, budget: { max_children: 2, qa_failure_limit: 1 } });
			await startBatch(args);
			const offers = ["task-a", "task-b"].map((id) => ({ task_id: id, path: fx.lane(id) }));
			await startBatch({ ...args, lane_offers: offers });
			kernel.reworking.add("task-a");
			kernel.frozen.add("task-a");
			const correct = (text: string) => startBatch({ ...args, lane_instruction: parseLaneInstruction({ task_id: "task-a", kind: "correction", text, session_state: "idle" }) });

			for (const round of [1, 2]) {
				const exhausted = lanes(await startBatch(args));
				const handoff = exhausted.handoffs.find((h) => h.task_id === "task-a")!;
				expect(handoff).toMatchObject({ role: "coordinator", action: "correct", corrections_used: round - 1, corrections_left: 3 - round, lane_path: offers[0]!.path });
				// No further Executor attempt is made while the correction is due.
				const attempts = kernel.advanced.length;
				await startBatch(args);
				expect(kernel.advanced.length).toBe(attempts);
				// An ordinary instruction is refused; the correction is accepted and counted.
				expect(lanes(await startBatch({ ...args, lane_instruction: parseLaneInstruction({ task_id: "task-a", text: "x", session_state: "idle" }) })).lane_instruction?.accepted).toBe(false);
				// After a QA rework the Lane's artifacts are active again until the new
				// session freezes its next delivery.
				kernel.frozen.delete("task-a");
				const corrected = lanes(await correct(`design-level correction ${round}`));
				expect(corrected.lane_instruction?.accepted).toBe(true);
				expect(corrected.children[0]).toMatchObject({ state: "enrolled", corrections: round, qa_failures: 0 });
				expect(corrected.children[0]!.correction_due).toBeUndefined();
				// The new session needs nothing but the Kernel projection and the Lane: the
				// executor handoff names both.
				expect(corrected.handoffs.find((h) => h.task_id === "task-a")).toMatchObject({ role: "executor", lane_path: offers[0]!.path, run_id: "run-1", next_obligation: "submit_assurance" });
				kernel.frozen.add("task-a"); // the new session delivers again, and QA fails again
			}

			// The sibling keeps moving throughout.
			writeFileSync(join(offers[1]!.path, "b.txt"), "b\n");
			kernel.frozen.add("task-b");
			const third = lanes(await startBatch(args));
			expect(third.children[0]!.state).toBe("needs_human");
			expect(third.children[0]!.reason).toStartWith(`${CORRECTION_LIMIT_REACHED}:`);
			expect(third.children[0]!.reason).not.toBe("QA failure limit reached");
			expect(third.children[1]!.state).toBe("integrated");
			expect(third.interventions?.filter((i) => i.kind === "correction")).toHaveLength(2);
			// A correction beyond the limit is never accepted or recorded.
			const beyond = lanes(await correct("third"));
			expect(beyond.lane_instruction?.accepted).not.toBe(true);
			expect((readAnyBatchRunState(fx.repo, BATCH_ID) as { interventions?: unknown[] }).interventions).toHaveLength(2);
		} finally {
			fx.cleanup();
		}
	}, 30000);
});
